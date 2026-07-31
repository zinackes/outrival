import { logger } from "../lib/job-logger";
import { NonRetriable as AbortTaskRunError } from "@outrival/queue";
import { z } from "zod";
import { and, desc, eq, ne } from "drizzle-orm";
import {
  db,
  battleCards,
  competitors,
  products,
  organizations,
  monitors,
  snapshots,
  reviews,
  signals,
  techStackEntries,
  selfProfileLastEditedAt,
  insertAiQualityCheck,
  type SelfProfile,
} from "@outrival/db";
import {
  generateBattleCard,
  reviseBattleCard,
  battleCardEvidence,
  wasTruncated,
  AI_CONFIG,
  type BattleCardContent,
} from "@outrival/ai";
import { checkFaithfulness, isBlocked, blockedReviewEntry } from "../lib/faithfulness-gate";
import {
  uploadToR2,
  getFromR2,
  resolveCurrentPricing,
  type CompetitorOverrides,
} from "@outrival/shared";
import { isCloudflareChallenge } from "@outrival/scrapers/block-detection";
import { htmlToText } from "../lib/html-to-text";
import {
  loggedAi,
  getLatestTrial,
  getLatestPricingTiers,
  getLatestReviewScore,
  getReviewScoreSeries,
} from "../lib/analytics";
import { detectThemeShifts, mergeRisingThemeObjections } from "../lib/review-theme-shift";
import { createBattleCardStream } from "../lib/battle-card-stream";
import { runRefreshCompetitorSummary } from "./refresh-competitor-summary";
import { notifyJobComplete } from "../lib/job-complete";

/** Every section empty. Checked twice: on the draft, and again on a repaired card
 * whose refused entries could have been the only ones it had. */
function isEmptyCard(c: BattleCardContent): boolean {
  return (
    c.their_strengths.length === 0 &&
    c.our_strengths.length === 0 &&
    c.their_weaknesses.length === 0 &&
    c.common_objections.length === 0 &&
    c.when_we_win.length === 0 &&
    c.when_we_lose.length === 0
  );
}

// Pull the latest homepage capture as clean text so the card grounds feature
// claims on what a product ACTUALLY says about itself — the biggest lever against
// stale parametric comparisons. Best-effort: null on no monitor / no snapshot / R2
// miss / anti-bot shell (mirrors refresh-competitor-summary's guard).
async function loadHomepageExcerpt(
  competitorId: string,
  maxChars = 3500,
): Promise<string | null> {
  const homepageMonitor = await db.query.monitors.findFirst({
    where: and(eq(monitors.competitorId, competitorId), eq(monitors.sourceType, "homepage")),
  });
  if (!homepageMonitor) return null;
  const latest = await db.query.snapshots.findFirst({
    where: eq(snapshots.monitorId, homepageMonitor.id),
    orderBy: desc(snapshots.scrapedAt),
  });
  if (!latest) return null;
  try {
    const html = await getFromR2(`${latest.r2Key}.html`);
    if (isCloudflareChallenge(html)) return null;
    return htmlToText(html).slice(0, maxChars);
  } catch (err) {
    logger.warn("Failed to load homepage snapshot for battle card", { err: String(err) });
    return null;
  }
}

const InputSchema = z.object({
  competitorId: z.string(),
  orgId: z.string(),
  // patch-28 — which product (SKU) this card defends. Optional: defaults to the
  // org's primary product (so single-product orgs and legacy callers are unchanged).
  productId: z.string().optional(),
  // Set by the on-demand generate route → drop a durable "battle card ready"
  // notification when the card lands, so a user who navigated away (the ~10-20s +
  // PDF render outlasts a page visit) isn't left without any signal it finished.
  notifyOnComplete: z.boolean().optional(),
});

// Runtime-neutral job body: shared verbatim by the pg-boss handler and the thin
// Trigger.dev wrapper in ../jobs/generate-battle-card.job.ts (deleted at the
// cutover). Beyond the header and the signature, one call changes: the summary
// warm-up no longer waits on a sibling job run (Decision #1 — pg-boss is
// fire-and-forget), it calls the same body inline.
//
// Every giving-up path below is an AbortTaskRunError, which pg-boss records as a
// COMPLETED job. That is right for the queue (retrying a truncated model reply or a
// missing profile changes nothing) and was wrong for everyone else: the run wrote no
// card, sent no notification and left no reason, so the user's page simply fell back
// to the "no card yet" template and they clicked Generate again. Prod 2026-07-29:
// three consecutive runs against LangChain, three silent nothings. The hook below
// makes the giving-up visible — the reason reaches the bell for a user who navigated
// away, and the throw still carries it into the job's output for a post-mortem.
export async function runGenerateBattleCard(payload: z.input<typeof InputSchema>) {
  return generate(payload);
}

/**
 * The bell entry for a run that gave up. Called by the pg-boss handler on the
 * TERMINAL attempt only — same rule as onScrapeMonitorFailure — because a
 * retryable error (a rate limit, a provider 5xx) fires this body once per attempt,
 * and one click produced three identical "could not be generated" toasts before
 * the retries were done. The user asked for one card; they get one verdict.
 *
 * Best-effort, like every notify here: it must never replace the real error with
 * an insert failure.
 */
export async function onGenerateBattleCardFailure(opts: {
  payload: z.input<typeof InputSchema>;
  error: unknown;
}): Promise<void> {
  const parsed = InputSchema.safeParse(opts.payload);
  if (!parsed.success || !parsed.data.notifyOnComplete) return;
  await notifyBattleCardFailed(parsed.data, opts.error);
}

async function notifyBattleCardFailed(
  input: z.output<typeof InputSchema>,
  err: unknown,
): Promise<void> {
  try {
    const competitor = await db.query.competitors.findFirst({
      where: eq(competitors.id, input.competitorId),
      columns: { name: true },
    });
    const linkUrl =
      `/dashboard/competitors/${input.competitorId}/battle-card` +
      (input.productId ? `?product=${input.productId}` : "");
    await notifyJobComplete({
      orgId: input.orgId,
      title: `Battle card vs ${competitor?.name ?? "this competitor"} could not be generated`,
      body: err instanceof Error ? err.message : String(err),
      linkUrl,
    });
  } catch (notifyErr) {
    logger.warn("Battle card failure notification skipped", { err: String(notifyErr) });
  }
}

async function generate(payload: z.input<typeof InputSchema>) {
    const input = InputSchema.parse(payload);
    logger.log("Starting generate-battle-card", input);

    const competitor = await db.query.competitors.findFirst({
      where: and(eq(competitors.id, input.competitorId), eq(competitors.orgId, input.orgId)),
    });
    if (!competitor) throw new AbortTaskRunError(`Competitor ${input.competitorId} not found`);

    const org = await db.query.organizations.findFirst({
      where: eq(organizations.id, input.orgId),
    });
    if (!org) throw new AbortTaskRunError(`Organization ${input.orgId} not found`);

    // patch-28 — resolve the product this card is for (the given one, else the org's
    // primary) and source "my product" from its self-competitor profile, so each
    // (product, competitor) couple gets a product-specific card. Falls back to the
    // org productProfile for a legacy org with no product row yet.
    const product = input.productId
      ? await db.query.products.findFirst({
          where: and(eq(products.id, input.productId), eq(products.orgId, org.id)),
        })
      : await db.query.products.findFirst({
          where: and(
            eq(products.orgId, org.id),
            eq(products.isPrimary, true),
            ne(products.status, "archived"),
          ),
        });
    const productSelf = product
      ? await db.query.competitors.findFirst({
          where: eq(competitors.id, product.selfCompetitorId),
        })
      : null;
    const sp = (productSelf?.selfProfile ?? null) as SelfProfile | null;
    const myCategory = sp?.category?.value ?? org.productProfile?.category ?? null;
    const myValueProp = sp?.valueProp?.value ?? org.productProfile?.valueProp ?? "";
    if (!myCategory) {
      // Reaches the user's bell now, so it names what they can do about it rather
      // than the org id they never see.
      throw new AbortTaskRunError(
        "Your product profile is empty, so there is nothing to compare this competitor against. Add your product's category and value proposition first.",
      );
    }
    const otherProducts = product
      ? await db.query.products.findMany({
          where: and(
            eq(products.orgId, org.id),
            ne(products.id, product.id),
            ne(products.status, "archived"),
          ),
          columns: { name: true },
        })
      : [];

    const recentSignals = await db.query.signals.findMany({
      where: eq(signals.competitorId, competitor.id),
      orderBy: desc(signals.createdAt),
      limit: 8,
    });

    // Latest detected free-trial state (patch-33) — a concrete acquisition lever for
    // the card. Best-effort: null when no pricing captured / pre-detection.
    const competitorTrial = await getLatestTrial(competitor.id);

    const praisesRows = await db.query.reviews.findMany({
      where: and(eq(reviews.competitorId, competitor.id), eq(reviews.author, "praise")),
      orderBy: desc(reviews.detectedAt),
      limit: 8,
    });
    const complaintsRows = await db.query.reviews.findMany({
      where: and(eq(reviews.competitorId, competitor.id), eq(reviews.author, "complaint")),
      orderBy: desc(reviews.detectedAt),
      limit: 8,
    });

    // Battle cards are grounded against the competitor's evidence (summary + reviews
    // + signals). A freshly added competitor has none of it, so the grounded model
    // drops every assertion and the card comes back all-empty. Generate the AI summary
    // first (built from the homepage snapshot) so the card has real material to ground
    // on — matching what already happens once a summary exists.
    let competitorSummary = competitor.aiSummary ?? competitor.description ?? null;
    if (!competitor.aiSummary) {
      logger.log("No AI summary yet — generating it before the battle card", {
        competitorId: competitor.id,
      });
      // Decision #1 (docs/trigger-to-pgboss-migration.md): pg-boss has no
      // job-result await, so the summary runs INLINE here instead of as a
      // triggerAndWait on the sibling job — same body, same output, no cross-job
      // waiting. Battle cards are on-demand, so paying for it in this run is fine.
      // Best-effort: a failed warm-up leaves the card grounded on what exists.
      try {
        const summaryRun = await runRefreshCompetitorSummary({ competitorId: competitor.id });
        if (summaryRun.ok && summaryRun.summary) {
          competitorSummary = summaryRun.summary;
        }
      } catch (err) {
        logger.warn("Inline summary warm-up failed, grounding on what exists", {
          competitorId: competitor.id,
          error: String(err),
        });
      }
    }

    // Real, current facts for BOTH sides — the fix for stale parametric comparisons.
    // Each is best-effort (empty/null when never captured) so the model abstains on a
    // dimension rather than inventing it. The competitor's evidence:
    // Apply the user's pricing overlay so the card reflects hand-edited/added/hidden
    // plans, not just raw detection (identical to detection when no overrides exist).
    // Quote-based tiers (price null) are dropped to keep the card's numeric shape.
    const detectedPricingTiers = await getLatestPricingTiers(competitor.id);
    const competitorPricingTiers = resolveCurrentPricing(
      detectedPricingTiers,
      (competitor.overrides ?? null) as CompetitorOverrides | null,
    )
      .filter((t): t is typeof t & { price: number } => t.price != null)
      .map((t) => ({
        planName: t.planName,
        price: t.price,
        currency: t.currency,
        billingPeriod: t.billingPeriod,
      }));
    const competitorTechRows = await db.query.techStackEntries.findMany({
      where: and(
        eq(techStackEntries.competitorId, competitor.id),
        eq(techStackEntries.isActive, true),
      ),
      orderBy: desc(techStackEntries.lastDetectedAt),
      limit: 20,
    });
    const competitorReviews = await getLatestReviewScore(competitor.id);
    const competitorHomepageExcerpt = await loadHomepageExcerpt(competitor.id);

    // Our own product's evidence — features / tech / pricing come from the self
    // profile (extract-self-profile keeps them current), homepage from its snapshot.
    const myFeatures = sp?.features?.value ?? [];
    const myTechStack = sp?.techStack?.value ?? [];
    const myPricingTiers = (sp?.pricingTiers?.value ?? []).map((t) => ({
      planName: t.plan_name,
      price: t.price,
      currency: t.currency,
      billingPeriod: t.billing_period,
    }));
    const myAudience = sp?.audience?.value ?? null;
    const myHomepageExcerpt = productSelf ? await loadHomepageExcerpt(productSelf.id) : null;

    const battleCardInput = {
      myProduct: {
        name: product?.name,
        category: myCategory,
        valueProp: myValueProp,
        audience: myAudience,
        features: myFeatures,
        techStack: myTechStack,
        pricingTiers: myPricingTiers,
        homepageExcerpt: myHomepageExcerpt,
      },
      competitorName: competitor.name,
      competitorSummary,
      competitorHomepageExcerpt,
      competitorTrial: competitorTrial
        ? {
            hasTrial: competitorTrial.has_trial,
            days: competitorTrial.days,
            requiresCreditCard: competitorTrial.requires_credit_card,
          }
        : null,
      competitorPricingTiers,
      competitorTechStack: competitorTechRows.map((t) => ({
        name: t.techName,
        category: t.category,
        importance: t.importance,
      })),
      competitorReviews,
      reviewPraises: praisesRows.map((r) => r.content ?? "").filter(Boolean),
      reviewComplaints: complaintsRows.map((r) => r.content ?? "").filter(Boolean),
      recentSignals: recentSignals.map((s) => ({
        category: s.category,
        severity: s.severity,
        insight: s.insight,
      })),
      otherProductNames: otherProducts.map((p) => p.name),
    };

    // Ops quality logging (patch-02): success / parse_failed (null) / error.
    const attribution = { orgId: org.id, competitorId: competitor.id };
    // Read the truncation flag INSIDE the closure: loggedAi opens the AI context
    // scope, so it is already gone by the time the await returns.
    let outputTruncated = false;
    let content = await loggedAi(
      "battle_card",
      AI_CONFIG.insights,
      async () => {
        const draft = await generateBattleCard(battleCardInput);
        outputTruncated = wasTruncated();
        return draft;
      },
      attribution,
    );

    if (!content) {
      // Two very different causes wear the same null. Say which: a truncation is
      // repaired by the token budget in packages/ai, a malformed reply by the
      // prompt or the provider. "returned null" sent everyone looking in the wrong
      // place — and told the user nothing at all.
      throw new AbortTaskRunError(
        outputTruncated
          ? "The model's reply was cut off before the card was complete. Try again — if it keeps happening, this competitor has more evidence than the card budget allows."
          : "The model returned an unreadable card. Try again in a moment.",
      );
    }

    // Phase 2A — verification pass with teeth: re-read the draft against the same
    // evidence and drop every claim that isn't traceable to it (removes the stale
    // one-sided comparisons the self-check only used to flag). Best-effort: on a
    // parse miss we keep the grounded draft rather than lose the card.
    //
    // This is also the pass the page WATCHES: it is the last one to touch the
    // content, so streaming it types out what will actually be published. Streaming
    // the draft instead would write claims this pass is about to delete.
    const stream = createBattleCardStream(competitor.id, product?.id ?? null);
    try {
      const draft = content;
      const revised = await loggedAi(
        "battle_card_revise",
        AI_CONFIG.insights,
        () => reviseBattleCard(battleCardInput, draft, undefined, stream.onPartial),
        attribution,
      );
      if (revised) content = revised;
      stream.flush();
    } catch (err) {
      // A verification failure (rate limit / breaker) must never sink the card —
      // patch-22 graceful degradation. Keep the draft; log the miss.
      logger.warn("Battle card revise pass skipped", { err: String(err) });
    }

    // Deterministic objection munition: fold the competitor's RISING complaint themes
    // (detected over the review_scores series) into common_objections, AFTER the AI
    // generate/revise passes so the fact-checker can't strip them. Best-effort — a
    // read miss must never sink the card. AI-free (themes already clustered upstream).
    try {
      const themeSeries = await getReviewScoreSeries(
        competitor.id,
        Number(process.env.REVIEW_THEME_LOOKBACK_DAYS ?? 84),
      );
      const rising =
        themeSeries.length >= 2
          ? detectThemeShifts(themeSeries, {
              now: new Date(),
              windowDays: Number(process.env.REVIEW_THEME_WINDOW_DAYS ?? 42),
            })
          : [];
      if (rising.length > 0) {
        content = mergeRisingThemeObjections(content, rising, {
          competitorName: competitor.name,
          myProductName: product?.name,
          valueProp: myValueProp,
        });
      }
    } catch (err) {
      logger.warn("Rising-theme objection injection skipped", { err: String(err) });
    }

    // Safety net: a grounded card with no evidence comes back with every section
    // empty (the schema permits empty arrays). Never persist a blank document — abort
    // with a clear reason so the UI surfaces a failure instead of a card full of "—".
    if (isEmptyCard(content)) {
      throw new AbortTaskRunError(
        "Battle card came back empty — no competitor summary, reviews or signals to ground on yet",
      );
    }

    const generatedAt = new Date();

    // Snapshot the inputs this card is based on (patch-22 staleness). The latest
    // competitor signal is recentSignals[0] (already ordered desc); the user's last
    // self-profile edit comes from this product's self-competitor (patch-28). Clear
    // the patch-21 "not useful" flag — a fresh generation supersedes it.
    const basedOnUserUpdateAt =
      selfProfileLastEditedAt(productSelf?.selfProfile) ?? productSelf?.updatedAt ?? null;
    const basedOnCompetitorSignalAt = recentSignals[0]?.createdAt ?? null;

    const existing = product
      ? await db.query.battleCards.findFirst({
          where: and(
            eq(battleCards.productId, product.id),
            eq(battleCards.competitorId, competitor.id),
          ),
        })
      : await db.query.battleCards.findFirst({
          where: eq(battleCards.competitorId, competitor.id),
        });

    // Claim-level faithfulness gate: decompose the card into atomic claims, verify
    // each against the SAME evidence with the fuzzy citation validator, and let the
    // binary judge settle the ones a quote can't. A blocked card is never written —
    // the previous card (if any) stays untouched rather than being overwritten by an
    // unfaithful one — and its failing claims land in the review queue.
    const evidence = battleCardEvidence(battleCardInput);
    let faithfulness = await checkFaithfulness({
      output: content,
      sourceText: evidence,
      outputKind: "sales battle card",
      context: { competitorId: competitor.id, productId: product?.id ?? null },
      attribution,
    });
    if (isBlocked(faithfulness) && faithfulness) {
      // One refused sentence used to cost the whole card: ~20 grounded bullets thrown
      // away over one, with nothing for the user to do but re-roll the same evidence.
      // So repair instead of discard — name the refused claims to the verification pass
      // that already exists, then RE-VERIFY the result. The guarantee stays end-to-end:
      // what publishes is what passed the gate, never what we believe we removed. That
      // is also why the refused claims are not matched against the card here — a fuzzy
      // match landing on the wrong entry would publish the refused claim.
      const original = faithfulness;
      const draft = content;
      const refused = original.unfaithfulClaims.map((c) => c.claim.text);
      let repaired: typeof content | null = null;
      try {
        repaired = await loggedAi(
          "battle_card_repair",
          AI_CONFIG.insights,
          () => reviseBattleCard(battleCardInput, draft, refused),
          attribution,
        );
      } catch (err) {
        // A repair that cannot run leaves the block standing — never the card.
        logger.warn("Battle card repair pass unavailable", { err: String(err) });
      }
      const recheck =
        repaired && !isEmptyCard(repaired)
          ? await checkFaithfulness({
              output: repaired,
              sourceText: evidence,
              outputKind: "sales battle card",
              context: {
                competitorId: competitor.id,
                productId: product?.id ?? null,
                repair: true,
              },
              attribution,
            })
          : null;
      // Strict on THIS path only: a clean pass publishes, a `skipped` does not.
      // Everywhere else an unavailable verification means publish-unverified, but this
      // content was already refused once — a provider outage mid-repair must not become
      // the way it gets through.
      const publishable = repaired && recheck?.verdict === "pass" ? repaired : null;

      await insertAiQualityCheck(
        blockedReviewEntry({
          aiTask: "generate_battle_card",
          targetType: "battle_card",
          targetId: existing?.id ?? null,
          orgId: org.id,
          quality: draft._quality,
          // The block is queued either way — whether the judge was right about these
          // claims is a question the repair does not answer.
          report: publishable ? { ...original, repaired: true } : original,
        }),
      );

      if (!publishable || !recheck) {
        throw new AbortTaskRunError(
          `Battle card blocked by the faithfulness gate: ${original.reason ?? "unsupported claims"}`,
        );
      }
      logger.log("Battle card published after repairing a faithfulness block", {
        competitorId: competitor.id,
        refusedClaims: refused.length,
        ratioBefore: original.ratio,
      });
      content = publishable;
      faithfulness = recheck;
    }

    let battleCardId: string;
    if (existing) {
      await db
        .update(battleCards)
        .set({
          content,
          faithfulness,
          generatedAt,
          updatedAt: generatedAt,
          basedOnUserUpdateAt,
          basedOnCompetitorSignalAt,
          flaggedForRegenerationAt: null,
        })
        .where(eq(battleCards.id, existing.id));
      battleCardId = existing.id;
    } else {
      const [created] = await db
        .insert(battleCards)
        .values({
          competitorId: competitor.id,
          productId: product?.id ?? null,
          orgId: org.id,
          content,
          faithfulness,
          generatedAt,
          updatedAt: generatedAt,
          basedOnUserUpdateAt,
          basedOnCompetitorSignalAt,
        })
        .returning();
      if (!created) throw new Error("Failed to insert battle card");
      battleCardId = created.id;
    }

    // The row is the source of truth from here — the streamed buffer would only be
    // a staler copy of it.
    await stream.close();

    // Anti-hallucination (patch-24): battle cards always get a systematic self-check
    // (the most visible critical output). Persist its envelope so a failed check
    // surfaces a warning on the card and lands in the ops review queue. Best-effort.
    await insertAiQualityCheck({
      aiTask: "generate_battle_card",
      targetType: "battle_card",
      targetId: battleCardId,
      orgId: org.id,
      quality: content._quality,
      faithfulness,
    });

    // Lazy-import to avoid loading playwright/Chromium bindings at module parse
    // time (trigger.dev warns on >1 s import — playwright is the culprit).
    const [{ chromium }, { renderBattleCardHtml }] = await Promise.all([
      import("playwright"),
      import("../lib/battle-card-html.js"),
    ]);

    const html = renderBattleCardHtml({
      competitorName: competitor.name,
      myProductCategory: myCategory,
      generatedAt,
      content,
    });

    const browser = await chromium.launch({ headless: true });
    let pdfBuffer: Buffer;
    try {
      const page = await browser.newPage();
      await page.setContent(html, { waitUntil: "networkidle" });
      pdfBuffer = Buffer.from(
        await page.pdf({ format: "A4", printBackground: true, margin: { top: "0", bottom: "0", left: "0", right: "0" } }),
      );
    } finally {
      await browser.close();
    }

    const r2Key = `battle-cards/${competitor.id}/${generatedAt.toISOString()}.pdf`;
    await uploadToR2(r2Key, pdfBuffer, "application/pdf");

    await db
      .update(battleCards)
      .set({ pdfR2Key: r2Key, updatedAt: new Date() })
      .where(eq(battleCards.id, battleCardId));

    if (input.notifyOnComplete) {
      // Deep-link to the competitor's battle card page, scoped to this SKU when the
      // request named one (the web product scope defaults to primary otherwise).
      // Notifications written before this page existed carry `?tab=battlecard`; the
      // competitor view still remaps that key, so old rows keep working.
      const linkUrl =
        `/dashboard/competitors/${competitor.id}/battle-card` +
        (input.productId ? `?product=${input.productId}` : "");
      await notifyJobComplete({
        orgId: org.id,
        title: `Battle card vs ${competitor.name} is ready`,
        body: "Your AI battle card is ready to view and download.",
        linkUrl,
      });
    }

    logger.log("Completed generate-battle-card", {
      battleCardId,
      pdfR2Key: r2Key,
      pdfBytes: pdfBuffer.length,
    });

    return { ok: true, battleCardId, pdfR2Key: r2Key };
}
