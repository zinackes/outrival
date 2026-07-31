import { logger } from "../lib/job-logger";
import { NonRetriable as AbortTaskRunError, generateSignal } from "@outrival/queue";
import { z } from "zod";
import { and, desc, eq } from "drizzle-orm";
import {
  db,
  competitors,
  organizations,
  monitors,
  snapshots,
  changes,
  calculatorSpecs,
} from "@outrival/db";
import {
  computeHash,
  uploadToR2,
  validatePublicUrl,
  validateProbeSeries,
  diffProbePoints,
  REFERENCE_VOLUME_PRESETS,
  maxPricingChangeSeverity,
  sortPricingChanges,
  CalculatorSpecSchema,
  type CalculatorSpec,
  type MeasuredPoint,
} from "@outrival/shared";
import {
  probeCalculator,
  type ProbeOutcome,
  type ProbeEvidence,
  type ProbeStrategy,
} from "@outrival/scrapers";
import { generateCalculatorSpec, AI_CONFIG } from "@outrival/ai";
import {
  insertPricePoints,
  getPreviousProbePoints,
  insertCalculatorProbeRun,
  loggedAi,
  type PricePointRow,
} from "../lib/analytics";
import { planPricingSignal } from "../lib/pricing-signals";

/**
 * Pricing Intelligence P4 — MEASURE a calculator-priced competitor.
 *
 * A `dynamic` pricing page publishes no list a differ can read: the price exists
 * only as the answer its calculator gives to a volume. This job asks that
 * question at the reference volumes, using the public UI the way a prospect
 * would, and stores the answers as price_points(method='calculator_probe') with
 * the proof each one was read from. That is the number Crayon and Klue cannot
 * produce, because it is not on the page — it is what the page does.
 *
 * Three properties hold at every exit:
 *   · a failed probe writes ZERO points. Never a partial series, never an
 *     extrapolation, never "the last value we managed to read" (validateProbeSeries
 *     drops the whole run on any failed check).
 *   · every stored point carries its own proof — a screenshot of the calculator,
 *     or the page's own pricing request replayed at that volume AFTER it was
 *     confirmed against a screenshot-backed reading. A point whose evidence could
 *     not be stored takes the run down with it.
 *   · a refusal (robots, block, login wall) is silent to the user and loud in
 *     calculator_probe_runs — the pricing pipeline of the same day stays a success.
 */

const InputSchema = z.object({
  competitorId: z.string(),
  monitorId: z.string(),
  url: z.string(),
});

/** Hours before the AI heal step may regenerate a spec for the same competitor. */
const HEAL_COOLDOWN_HOURS = Number(process.env.CALCULATOR_HEAL_COOLDOWN_HOURS ?? 72);
/** Interaction budget bounds the run, so bound the questions we ask too. */
const MAX_QUANTITIES = 6;

export async function runProbePricingCalculator(payload: z.input<typeof InputSchema>) {
  const input = InputSchema.parse(payload);
  const startedAt = Date.now();
  logger.log("Starting probe-pricing-calculator", input);

  if (process.env.PRICING_CALCULATOR_PROBE_ENABLED === "false") {
    return { skipped: true, reason: "disabled" };
  }

  const competitor = await db.query.competitors.findFirst({
    where: eq(competitors.id, input.competitorId),
  });
  if (!competitor) throw new AbortTaskRunError(`Competitor ${input.competitorId} not found`);
  if (competitor.deletedAt) return { skipped: true, reason: "deleted" };
  // Our own calculator tells us nothing we don't already own.
  if (competitor.type === "self") return { skipped: true, reason: "self" };

  const safe = validatePublicUrl(input.url);
  if (!safe.ok) {
    await insertCalculatorProbeRun({
      competitor_id: competitor.id,
      url: input.url,
      strategy: "none",
      outcome: "unsafe_url",
      detail: safe.error,
    });
    return { skipped: true, reason: "unsafe_url" };
  }

  const quantities = await referenceQuantities(competitor.orgId);
  const cached = await db.query.calculatorSpecs.findFirst({
    where: eq(calculatorSpecs.competitorId, competitor.id),
  });
  const cachedSpec = parseSpec(cached?.spec);

  // ── Probe, heal once, probe again ─────────────────────────────────────────
  // The staged-extraction cycle, applied to an interaction: deterministic
  // heuristics (or a cached recipe) first, ONE AI call only when they fail on a
  // page we know is a calculator, and the result cached so the next run is
  // AI-free again. The AI only ever names selectors — every amount below is read
  // and judged by code.
  let outcome = await probeCalculator({
    url: input.url,
    quantities,
    spec: cachedSpec,
  });
  let healed = false;

  const healInput = outcome.ok ? null : (outcome.prunedHtml ?? null);
  if (healInput && canHeal(cached?.lastHealAttemptAt ?? null)) {
    // The AI half is best-effort by contract: loggedAi rethrows so a job can be
    // retried on a provider error, but a probe has nothing to retry — the whole
    // phase is allowed to measure nothing. An unreachable pool means no heal this
    // week, not a failed job in the dead-letter queue.
    const generated = await loggedAi(
      "generate_calculator_spec",
      AI_CONFIG.classification,
      () => generateCalculatorSpec(healInput),
      { competitorId: competitor.id },
    ).catch((err: unknown) => {
      logger.warn("Calculator spec heal unavailable (non-fatal)", {
        competitorId: competitor.id,
        error: String(err),
      });
      return null;
    });
    await recordHealAttempt(competitor.id, input.url, generated, cached?.id ?? null);
    if (generated) {
      healed = true;
      outcome = await probeCalculator({ url: input.url, quantities, spec: generated });
    }
  }

  const log = (outcomeName: string, extra: Partial<Parameters<typeof insertCalculatorProbeRun>[0]> = {}) =>
    insertCalculatorProbeRun({
      competitor_id: competitor.id,
      url: input.url,
      strategy: outcome.ok ? outcome.strategy : "none",
      outcome: outcomeName,
      healed,
      duration_ms: Date.now() - startedAt,
      ...extra,
    });

  if (!outcome.ok) {
    // Silent to the user by design: a competitor whose calculator we cannot drive
    // simply has no measured points, exactly as before this phase existed.
    logger.log("Calculator probe did not measure", {
      competitorId: competitor.id,
      reason: outcome.reason,
      detail: outcome.detail,
    });
    await noteSpecFailure(cached?.id ?? null, outcome);
    await log(outcome.reason, { detail: outcome.detail ?? null });
    return { measured: false, reason: outcome.reason };
  }

  // ── Believe it, or drop it ────────────────────────────────────────────────
  const measured = outcome; // narrowed past the guard above, and used in closures
  const verdict = validateProbeSeries(measured.readings);
  if (!verdict.ok) {
    logger.warn("Calculator probe dropped by sanity checks", {
      competitorId: competitor.id,
      reason: verdict.reason,
      detail: verdict.detail,
      readings: measured.readings.length,
    });
    await log(verdict.reason, {
      detail: verdict.detail,
      meter_unit: measured.unit,
      readings: measured.readings.length,
    });
    return { measured: false, reason: verdict.reason };
  }

  // Evidence is not optional: a point with nothing behind it is a claim, and one
  // such point drops the run. Two shapes, one rule — a screenshot for a volume read
  // off the rendered calculator, the endpoint's own request/response for a volume
  // replayed after that endpoint was confirmed against a screenshot-backed reading.
  const evidenceByQty = new Map(measured.evidence.map((e: ProbeEvidence) => [e.qty, e]));
  const missing = verdict.readings.filter((r) => {
    const e = evidenceByQty.get(r.qty);
    return !e || (e.kind === "screenshot" ? !e.png : !e.json);
  });
  if (missing.length > 0) {
    await log("evidence_missing", {
      detail: `${missing.length} of ${verdict.readings.length} readings had no proof`,
      meter_unit: measured.unit,
      readings: verdict.readings.length,
    });
    return { measured: false, reason: "evidence_missing" };
  }

  const recordedAt = new Date();
  const batch = recordedAt.toISOString();
  const prefix = `calculator-probes/${competitor.id}/${batch}`;
  const evidence = new Map<number, { key: string; kind: "screenshot" | "api_response" }>();
  let anchorScreenshotKey: string | null = null;
  try {
    for (const reading of verdict.readings) {
      const proof = evidenceByQty.get(reading.qty)!;
      if (proof.kind === "screenshot") {
        const key = `${prefix}/${reading.qty}.png`;
        await uploadToR2(key, proof.png!, "image/png");
        evidence.set(reading.qty, { key, kind: "screenshot" });
        anchorScreenshotKey ??= key;
      } else {
        const key = `${prefix}/${reading.qty}.json`;
        await uploadToR2(key, proof.json!, "application/json; charset=utf-8", { compress: true });
        evidence.set(reading.qty, { key, kind: "api_response" });
      }
    }
  } catch (err) {
    // R2 before DB, as everywhere: a point can never exist without its proof.
    logger.error("Calculator probe evidence upload failed — dropping the run", {
      competitorId: competitor.id,
      err: String(err),
    });
    await log("evidence_upload_failed", { detail: String(err), meter_unit: measured.unit });
    return { measured: false, reason: "evidence_upload_failed" };
  }

  // The baseline is read BEFORE the fresh batch lands, like every other differ
  // in the pricing stack.
  const previous = await getPreviousProbePoints(competitor.id);

  const rows: PricePointRow[] = verdict.readings.map((r) => ({
    competitor_id: competitor.id,
    plan_name: measured.planName,
    meter_unit: measured.unit,
    reference_qty: r.qty,
    effective_monthly_cost: round2(r.cost),
    currency: verdict.currency,
    method: "calculator_probe" as const,
    evidence_key: evidence.get(r.qty)?.key ?? null,
    evidence_kind: evidence.get(r.qty)?.kind ?? null,
    recorded_at: recordedAt,
  }));
  await insertPricePoints(rows);
  await upsertSpec(competitor.id, input.url, measured.spec, cached?.id ?? null, healed);

  // ── Signal ────────────────────────────────────────────────────────────────
  const emitted = await emitProbeSignal({
    competitorId: competitor.id,
    competitorName: competitor.name,
    monitorId: input.monitorId,
    url: measured.finalUrl,
    previous: (previous ?? []).map(toMeasuredPoint),
    current: rows.map(toMeasuredPoint),
    strategy: measured.strategy,
  });

  await log("measured", {
    meter_unit: measured.unit,
    readings: verdict.readings.length,
    points_written: rows.length,
    anchor_screenshot_key: anchorScreenshotKey,
  });
  logger.log("Completed probe-pricing-calculator", {
    competitorId: competitor.id,
    strategy: measured.strategy,
    unit: measured.unit,
    points: rows.length,
    signal: emitted,
  });
  return { measured: true, points: rows.length, unit: measured.unit, signal: emitted };
}

// ---------------------------------------------------------------------------
// Volumes
// ---------------------------------------------------------------------------

/**
 * The volumes to ask about: the four presets every competitor is read at (which
 * is what makes two of them comparable at a glance), plus any volume this
 * workspace named for itself. The workspace's units aren't known to matter until
 * the control is picked, so its quantities ride along and simply never match a
 * different meter's series.
 */
async function referenceQuantities(orgId: string): Promise<number[]> {
  const org = await db.query.organizations.findFirst({
    where: eq(organizations.id, orgId),
    columns: { referenceVolumes: true },
  });
  const custom = (org?.referenceVolumes ?? [])
    .map((v) => v.qty)
    .filter((q) => Number.isFinite(q) && q > 0);
  const all = [...new Set([...REFERENCE_VOLUME_PRESETS, ...custom])].sort((a, b) => a - b);
  return all.slice(0, MAX_QUANTITIES);
}

// ---------------------------------------------------------------------------
// Spec cache
// ---------------------------------------------------------------------------

function parseSpec(raw: unknown): CalculatorSpec | null {
  if (!raw) return null;
  const parsed = CalculatorSpecSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

function canHeal(lastAttempt: Date | null): boolean {
  if (!lastAttempt) return true;
  return Date.now() - lastAttempt.getTime() > HEAL_COOLDOWN_HOURS * 3_600_000;
}

/** Stamp the heal attempt whether or not it produced a spec — the cooldown has to
 * cost the same either way, or a page the model can't read burns a call a day. */
async function recordHealAttempt(
  competitorId: string,
  url: string,
  generated: CalculatorSpec | null,
  existingId: string | null,
): Promise<void> {
  const now = new Date();
  if (existingId) {
    await db
      .update(calculatorSpecs)
      .set({
        lastHealAttemptAt: now,
        healCount: (await currentHealCount(existingId)) + 1,
        ...(generated ? { spec: generated, version: generated.version + 1 } : {}),
        updatedAt: now,
      })
      .where(eq(calculatorSpecs.id, existingId));
    return;
  }
  if (!generated) return; // nothing worth a row yet
  await db.insert(calculatorSpecs).values({
    competitorId,
    url,
    spec: generated,
    version: 1,
    healCount: 1,
    lastHealAttemptAt: now,
  });
}

async function currentHealCount(id: string): Promise<number> {
  const row = await db.query.calculatorSpecs.findFirst({
    where: eq(calculatorSpecs.id, id),
    columns: { healCount: true },
  });
  return row?.healCount ?? 0;
}

/** A run that measured is a run whose recipe works — cache it as the new truth. */
async function upsertSpec(
  competitorId: string,
  url: string,
  spec: CalculatorSpec,
  existingId: string | null,
  healed: boolean,
): Promise<void> {
  const now = new Date();
  if (existingId) {
    await db
      .update(calculatorSpecs)
      .set({ spec, url, lastValidatedAt: now, consecutiveFailures: 0, updatedAt: now })
      .where(eq(calculatorSpecs.id, existingId));
    return;
  }
  await db.insert(calculatorSpecs).values({
    competitorId,
    url,
    spec,
    version: spec.version,
    healCount: healed ? 1 : 0,
    lastValidatedAt: now,
  });
}

/** Count the failures a cached recipe is responsible for, so a durably-broken one
 * is visible rather than silently retried forever. */
async function noteSpecFailure(existingId: string | null, outcome: ProbeOutcome): Promise<void> {
  if (!existingId || outcome.ok) return;
  const row = await db.query.calculatorSpecs.findFirst({
    where: eq(calculatorSpecs.id, existingId),
    columns: { consecutiveFailures: true },
  });
  await db
    .update(calculatorSpecs)
    .set({ consecutiveFailures: (row?.consecutiveFailures ?? 0) + 1, updatedAt: new Date() })
    .where(eq(calculatorSpecs.id, existingId));
}

// ---------------------------------------------------------------------------
// Signal
// ---------------------------------------------------------------------------

const toMeasuredPoint = (r: PricePointRow): MeasuredPoint => ({
  planName: r.plan_name,
  meterUnit: r.meter_unit,
  referenceQty: r.reference_qty,
  effectiveMonthlyCost: r.effective_monthly_cost,
  currency: r.currency,
});

/**
 * What the same calculator now charges for the same volume, when that moved.
 *
 * Emitted through the synthetic anchor → snapshot → change → generate-signal
 * chain that review_shift / hiring_shift use, on the competitor's own
 * `pricing_probe` anchor monitor. Capped at HIGH inside diffProbePoints: a
 * measured reading is one observation of a UI, and critical is the band that
 * bypasses moderation and pages someone.
 */
async function emitProbeSignal(args: {
  competitorId: string;
  competitorName: string;
  monitorId: string;
  url: string;
  previous: MeasuredPoint[];
  current: MeasuredPoint[];
  strategy: ProbeStrategy;
}): Promise<"none" | "emitted"> {
  const moves = sortPricingChanges(diffProbePoints(args.previous, args.current));
  if (moves.length === 0) return "none";

  try {
    let monitor = await db.query.monitors.findFirst({
      where: and(
        eq(monitors.competitorId, args.competitorId),
        eq(monitors.sourceType, "pricing_probe"),
      ),
    });
    if (!monitor) {
      [monitor] = await db
        .insert(monitors)
        .values({
          competitorId: args.competitorId,
          sourceType: "pricing_probe",
          frequency: "weekly", // unused — this monitor is never scheduled
          isActive: false,
          config: {},
        })
        .returning();
    }
    if (!monitor) throw new Error("Failed to ensure pricing_probe monitor");

    const prevSnapshot = await db.query.snapshots.findFirst({
      where: eq(snapshots.monitorId, monitor.id),
      orderBy: desc(snapshots.scrapedAt),
    });

    const plan = planPricingSignal(moves);
    const evidence =
      `Measured on ${args.competitorName}'s own pricing calculator (${args.url}), ` +
      `reading the total it displays at fixed volumes` +
      `${args.strategy === "ui" ? "" : " and the pricing response behind it"}. ` +
      `Each figure below is a screenshot-backed reading, not a published list price.`;
    const diffText = `${plan.diffText}\n\n${evidence}`;
    const contentHash = computeHash(
      moves.map((m) => `${m.planName}|${m.unit}|${m.previousValue}|${m.currentValue}`).join("\n"),
    );
    // The same move re-measured (a probe that ran twice in a window) is not news.
    if (prevSnapshot?.contentHash === contentHash) return "none";

    const now = new Date();
    const r2Key = `snapshots/${args.competitorId}/pricing_probe/${now.toISOString()}`;
    await uploadToR2(`${r2Key}.txt`, diffText, "text/plain; charset=utf-8", { compress: true });

    const [snapshot] = await db
      .insert(snapshots)
      .values({
        monitorId: monitor.id,
        r2Key,
        contentHash,
        status: "success",
        scrapedAt: now,
        resolvedUrl: args.url,
      })
      .returning();
    if (!snapshot) throw new Error("Failed to insert pricing_probe snapshot");

    const [change] = await db
      .insert(changes)
      .values({
        monitorId: monitor.id,
        snapshotBeforeId: prevSnapshot?.id ?? null,
        snapshotAfterId: snapshot.id,
        diffText,
        diffType: "text",
        rawDiff: { probeChanges: moves },
        summary: plan.classification.reason,
        detectedAt: now,
      })
      .returning();
    if (!change) throw new Error("Failed to insert pricing_probe change");

    await generateSignal.enqueue(
      {
        changeId: change.id,
        classification: {
          ...plan.classification,
          // Belt and braces: diffProbePoints never returns critical, and the
          // severity that reaches the dispatcher must not either.
          severity: maxPricingChangeSeverity(moves) === "critical" ? "high" : plan.classification.severity,
        },
      },
      { singletonKey: change.id },
    );
    return "emitted";
  } catch (err) {
    // The points are already stored — a lost signal is the lesser failure, and
    // the next probe compares against the same baseline.
    logger.warn("Calculator probe signal emission failed (non-fatal)", {
      competitorId: args.competitorId,
      error: String(err),
    });
    return "none";
  }
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
