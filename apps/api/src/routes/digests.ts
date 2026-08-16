import { Hono } from "hono";
import { z } from "zod";
import { and, count, desc, eq, gte, isNull, lt, ne, notInArray, or } from "drizzle-orm";
import {
  digests,
  signals,
  competitors,
  organizations,
  monitors,
  changes,
  loadMemorySignals,
} from "@outrival/db";
import {
  capDigestSignals,
  DIGEST_MAX_SIGNALS,
  generateDigest,
  toMyProductContext,
  type DigestInputSignal,
} from "@outrival/ai";
import {
  buildCompetitorMemory,
  MEMORY_HISTORY_CAP,
  renderDigestEmail,
  signDigestFeedbackToken,
  signUnsubscribeToken,
  type DigestEmailData,
} from "@outrival/shared";
import { db } from "../lib/db";
import { inProgressWindow } from "../lib/digest-window";
import { authMiddleware } from "../middleware/auth";
import { ensureUserOrg } from "../lib/org";
import { sendEmail, ALERT_FROM } from "../lib/resend";

type Variables = { user: { id: string } };

export const digestsRouter = new Hono<{ Variables: Variables }>();

digestsRouter.use("*", authMiddleware);

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

type DigestRange = "this_week" | "last_7_days" | "last_30_days";

const GenerateSchema = z.object({
  range: z.enum(["this_week", "last_7_days", "last_30_days"]).optional(),
  // Custom date-range picker: explicit ISO bounds win over `range` when both set.
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
});

// [start, end) signal window for on-demand generation, UTC-aligned like the cron.
function rangeWindow(range: DigestRange): {
  start: Date;
  end: Date;
} {
  const end = new Date();
  if (range === "this_week") {
    const start = new Date(end);
    start.setUTCHours(0, 0, 0, 0);
    const sinceMonday = (start.getUTCDay() + 6) % 7; // Mon=0 … Sun=6
    start.setUTCDate(start.getUTCDate() - sinceMonday);
    return { start, end };
  }
  const days = range === "last_30_days" ? 30 : 7;
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - days);
  return { start, end };
}

digestsRouter.get("/", async (c) => {
  const user = c.get("user");
  const orgId = await ensureUserOrg(user.id);

  // Both weekly + daily records, newest first. The client tabs by `period`.
  const list = await db.query.digests.findMany({
    where: eq(digests.orgId, orgId),
    orderBy: desc(digests.createdAt),
    limit: 100,
  });
  return c.json({ digests: list });
});

/** Same severity → urgency rule the daily job uses, so both read on one scale. */
function severityToUrgency(severity: string): "action_required" | "watch" | "fyi" {
  if (severity === "critical" || severity === "high") return "action_required";
  if (severity === "medium") return "watch";
  return "fyi";
}

/**
 * What the next Monday brief has collected so far. The list only ever showed finished
 * issues, so between two Mondays the page read as if nothing were running — this is
 * the week under construction, named by the same window the cron will use.
 *
 * Returns null (and renders nothing) when there is no brief to anticipate: the window
 * is empty, or its digest already exists because the cron ran or someone wrote one by
 * hand. An "in progress" card next to the finished article it describes is noise.
 *
 * `?signals=1` adds the collected moves themselves, for the detail page. They are left
 * off the default response because the list page only needs the counts, and a busy org
 * carries hundreds of insights the card would never render.
 */
digestsRouter.get("/in-progress", async (c) => {
  const user = c.get("user");
  const orgId = await ensureUserOrg(user.id);
  const withSignals = c.req.query("signals") === "1";

  const now = new Date();
  const { start, end, nextRunAt } = inProgressWindow(now);

  const existing = await db.query.digests.findFirst({
    where: and(
      eq(digests.orgId, orgId),
      eq(digests.weekStart, isoDate(start)),
      eq(digests.period, "weekly"),
    ),
    columns: { id: true },
  });
  if (existing) return c.json({ inProgress: null });

  // Upper bound clamped to the window: on a Monday before 08:00 the wall clock has
  // already passed `end`, and the cron will not carry those signals into this brief.
  const upper = now < end ? now : end;
  const rows = await db
    .select({
      id: signals.id,
      competitor: competitors.name,
      competitorId: competitors.id,
      competitorColor: competitors.color,
      competitorUrl: competitors.url,
      category: signals.category,
      severity: signals.severity,
      insight: signals.insight,
      soWhat: signals.soWhat,
      createdAt: signals.createdAt,
    })
    .from(signals)
    .innerJoin(competitors, eq(competitors.id, signals.competitorId))
    .where(
      and(
        eq(signals.orgId, orgId),
        gte(signals.createdAt, start),
        lt(signals.createdAt, upper),
        // Mirrors the cron: a signal the faithfulness gate refused to publish is not
        // going to be in the brief, so counting it here would promise a bigger week
        // than the one that ships.
        or(
          isNull(signals.filteredReason),
          ne(signals.filteredReason, "faithfulness_blocked"),
        ),
      ),
    )
    .orderBy(desc(signals.createdAt));

  if (rows.length === 0) return c.json({ inProgress: null });

  const byCompetitor = new Map<string, number>();
  let action = 0;
  let watch = 0;
  let fyi = 0;
  for (const r of rows) {
    const urgency = severityToUrgency(r.severity);
    if (urgency === "action_required") action += 1;
    else if (urgency === "watch") watch += 1;
    else fyi += 1;
    const name = r.competitor.trim();
    if (name) byCompetitor.set(name, (byCompetitor.get(name) ?? 0) + 1);
  }

  const movers = [...byCompetitor.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));

  // The generator only ever sees DIGEST_MAX_SIGNALS moves, top severity first. A week
  // that collected more will ship a brief that silently leaves the tail out, so the
  // overflow is reported rather than hidden — a page promising 34 moves and an email
  // carrying 30 is the kind of gap nobody can debug from the outside.
  const omitted = Math.max(0, rows.length - DIGEST_MAX_SIGNALS);

  const base = {
    weekStart: isoDate(start),
    weekEnd: isoDate(end),
    nextRunAt: nextRunAt.toISOString(),
    moves: rows.length,
    action,
    watch,
    fyi,
    movers,
    cap: { max: DIGEST_MAX_SIGNALS, omitted },
  };
  if (!withSignals) return c.json({ inProgress: base });

  // Which moves survive the cap, decided by the generator's own ranking rather than a
  // second implementation of it: `capDigestSignals` returns the very objects it was
  // handed, so the ids ride along and cannot drift from what the brief will carry.
  const ranked = rows.map((r) => ({
    id: r.id,
    competitor: r.competitor,
    category: r.category,
    severity: r.severity,
    insight: r.insight,
    so_what: r.soWhat,
  }));
  const kept = capDigestSignals(ranked).kept as Array<(typeof ranked)[number]>;
  const keptIds = new Set(kept.map((k) => k.id));

  // Accumulated memory (OUT-172), built from the same loader and the same builder the
  // cron uses, so the preview shows the block Monday's brief will actually carry rather
  // than a second approximation of it. Detail fetch only: the card needs counts, and
  // this reads the whole tracking period, not just the window above.
  const memory = buildCompetitorMemory(
    await loadMemorySignals({ orgId, limit: MEMORY_HISTORY_CAP }),
    { now },
  );

  return c.json({
    inProgress: {
      ...base,
      ...(memory.stories.length > 0
        ? {
            competitorStories: memory.stories,
            competitorStoriesOmitted: memory.omitted,
          }
        : {}),
      signals: rows.map((r) => ({
        id: r.id,
        competitor: r.competitor,
        competitorId: r.competitorId,
        competitorColor: r.competitorColor,
        competitorUrl: r.competitorUrl,
        category: r.category,
        severity: r.severity,
        urgency: severityToUrgency(r.severity),
        insight: r.insight,
        soWhat: r.soWhat,
        createdAt: r.createdAt,
        inBrief: keptIds.has(r.id),
      })),
    },
  });
});

// On-demand digest for the current week / a rolling window. In-app preview only
// (no email): the weekly cron finalizes and emails unsent previews on Monday.
digestsRouter.post("/generate", async (c) => {
  const user = c.get("user");
  const orgId = await ensureUserOrg(user.id);

  const body = await c.req.json().catch(() => ({}));
  const parsed = GenerateSchema.safeParse(body ?? {});
  if (!parsed.success) {
    return c.json({ error: "Invalid body", issues: parsed.error.issues }, 400);
  }
  const { from, to } = parsed.data;
  const { start, end } =
    from && to
      ? { start: new Date(from), end: new Date(to) }
      : rangeWindow(parsed.data.range ?? "this_week");

  const rows = await db
    .select({
      competitor: competitors.name,
      category: signals.category,
      severity: signals.severity,
      insight: signals.insight,
      soWhat: signals.soWhat,
    })
    .from(signals)
    .innerJoin(competitors, eq(competitors.id, signals.competitorId))
    .where(
      and(
        eq(signals.orgId, orgId),
        gte(signals.createdAt, start),
        lt(signals.createdAt, end),
      ),
    );

  if (rows.length === 0) {
    return c.json({ digest: null, reason: "no_signals" });
  }

  const input: DigestInputSignal[] = rows.map((s) => ({
    competitor: s.competitor,
    category: s.category,
    severity: s.severity,
    insight: s.insight,
    so_what: s.soWhat,
  }));

  // Frame the digest from the org's own product perspective when profiled (P1).
  const orgRow = await db.query.organizations.findFirst({
    where: eq(organizations.id, orgId),
    columns: { productProfile: true },
  });
  const content = await generateDigest(input, toMyProductContext(orgRow?.productProfile));
  if (!content) {
    return c.json({ error: "generation_failed" }, 502);
  }

  const weekStart = isoDate(start);
  const weekEnd = isoDate(end);

  // Reuse an existing unsent weekly preview for the same window (re-click = refresh);
  // never clobber a digest the cron already sent, and never match a daily row.
  const existing = await db.query.digests.findFirst({
    where: and(
      eq(digests.orgId, orgId),
      eq(digests.weekStart, weekStart),
      eq(digests.period, "weekly"),
      isNull(digests.sentAt),
    ),
  });

  const stored = existing
    ? await db
        .update(digests)
        .set({ content, temperature: content.temperature, weekEnd })
        .where(eq(digests.id, existing.id))
        .returning()
    : await db
        .insert(digests)
        .values({
          orgId,
          weekStart,
          weekEnd,
          content,
          temperature: content.temperature,
          period: "weekly",
        })
        .returning();

  return c.json({ digest: stored[0] });
});

// Internal monitoring anchors with no user-facing meaning — mirrors HIDDEN_SOURCES in
// routes/activity.ts and INTERNAL_SOURCES in workers' lib/digest-counts.ts. Never
// counted as a "page" Outrival watches on the user's behalf.
const INTERNAL_SOURCES = ["tech_stack", "sitemap", "news", "subdomains", "youtube"] as const;

/**
 * [start, end) covering a digest's period.
 *
 * `weekEnd` is the EXCLUSIVE upper bound both producers use (the cron runs
 * [monday-7d, monday), the on-demand route stores isoDate(now)), so the day is added
 * back to cover an on-demand digest generated mid-day and a daily digest whose two
 * dates are equal. Over-covering is safe by construction here: the digest was written
 * from signals inside the window, so a wider window can only ADD candidates — which
 * makes a match ambiguous and yields no link — never replace the true one.
 */
function digestWindow(weekStart: string, weekEnd: string): { start: Date; end: Date } {
  const start = new Date(`${weekStart}T00:00:00.000Z`);
  const end = new Date(`${weekEnd}T00:00:00.000Z`);
  end.setUTCDate(end.getUTCDate() + 1);
  return { start, end };
}

interface SectionLink {
  competitorId: string | null;
  competitorColor: string | null;
  // The competitor's site, used to render its favicon beside its name in the brief.
  competitorUrl: string | null;
  signalId: string | null;
}

/**
 * Point each digest section at the entities it is about, so a brief stops being a
 * dead end. Deterministic and strict, never AI: a competitor resolves by exact
 * (case-insensitive) name inside the org, and a signal only when exactly ONE signal
 * of that competitor+category exists in the period. Anything ambiguous stays null and
 * renders as plain text, because a plausible wrong link is worse than no link.
 */
async function resolveSections(
  orgId: string,
  sections: Array<{ competitor?: unknown; category?: unknown }>,
  window: { start: Date; end: Date },
): Promise<SectionLink[]> {
  const empty = (): SectionLink[] =>
    sections.map(() => ({
      competitorId: null,
      competitorColor: null,
      competitorUrl: null,
      signalId: null,
    }));
  if (sections.length === 0) return [];

  const rows = await db
    .select({
      signalId: signals.id,
      category: signals.category,
      competitorId: competitors.id,
      competitorName: competitors.name,
      competitorColor: competitors.color,
      competitorUrl: competitors.url,
    })
    .from(signals)
    .innerJoin(competitors, eq(competitors.id, signals.competitorId))
    .where(
      and(
        eq(signals.orgId, orgId),
        // A competitor deleted since would 404 on its page: leave those unlinked.
        isNull(competitors.deletedAt),
        gte(signals.createdAt, window.start),
        lt(signals.createdAt, window.end),
      ),
    );
  if (rows.length === 0) return empty();

  const byName = new Map<string, { id: string; color: string | null; url: string | null }>();
  const byCompetitorCategory = new Map<string, string[]>();
  for (const r of rows) {
    const name = r.competitorName.toLowerCase().trim();
    if (!byName.has(name)) {
      byName.set(name, { id: r.competitorId, color: r.competitorColor, url: r.competitorUrl });
    }
    const key = `${r.competitorId}|${r.category}`;
    const bucket = byCompetitorCategory.get(key);
    if (bucket) bucket.push(r.signalId);
    else byCompetitorCategory.set(key, [r.signalId]);
  }

  return sections.map((s) => {
    const name = typeof s.competitor === "string" ? s.competitor.toLowerCase().trim() : "";
    const competitor = name ? byName.get(name) : undefined;
    if (!competitor) {
      return {
        competitorId: null,
        competitorColor: null,
        competitorUrl: null,
        signalId: null,
      };
    }
    const category = typeof s.category === "string" ? s.category.toLowerCase().trim() : "";
    const candidates = byCompetitorCategory.get(`${competitor.id}|${category}`) ?? [];
    return {
      competitorId: competitor.id,
      competitorColor: competitor.color,
      competitorUrl: competitor.url,
      signalId: candidates.length === 1 ? candidates[0]! : null,
    };
  });
}

/**
 * What the period cost to produce: pages watched, and raw changes found before the
 * pipeline filtered them down to the brief. Best-effort — the brief renders without
 * it rather than failing on a slow count.
 */
async function digestProvenance(
  orgId: string,
  window: { start: Date; end: Date },
): Promise<{ pages: number; changes: number } | null> {
  try {
    const [pageRow] = await db
      .select({ n: count() })
      .from(monitors)
      .innerJoin(competitors, eq(competitors.id, monitors.competitorId))
      .where(
        and(
          eq(competitors.orgId, orgId),
          isNull(competitors.deletedAt),
          ne(competitors.type, "self"),
          eq(monitors.isActive, true),
          notInArray(monitors.sourceType, [...INTERNAL_SOURCES]),
        ),
      );

    const [changeRow] = await db
      .select({ n: count() })
      .from(changes)
      .innerJoin(monitors, eq(monitors.id, changes.monitorId))
      .innerJoin(competitors, eq(competitors.id, monitors.competitorId))
      .where(
        and(
          eq(competitors.orgId, orgId),
          isNull(competitors.deletedAt),
          gte(changes.detectedAt, window.start),
          lt(changes.detectedAt, window.end),
        ),
      );

    return { pages: pageRow?.n ?? 0, changes: changeRow?.n ?? 0 };
  } catch (err) {
    console.error("Digest provenance failed", { orgId, err: String(err) });
    return null;
  }
}

digestsRouter.get("/:id", async (c) => {
  const user = c.get("user");
  const orgId = await ensureUserOrg(user.id);
  const id = c.req.param("id");

  const digest = await db.query.digests.findFirst({
    where: and(eq(digests.id, id), eq(digests.orgId, orgId)),
  });
  if (!digest) return c.json({ error: "Not found" }, 404);

  const content = digest.content as { sections?: Array<{ competitor?: unknown; category?: unknown }> };
  const window = digestWindow(digest.weekStart, digest.weekEnd);
  const [links, provenance] = await Promise.all([
    resolveSections(orgId, content.sections ?? [], window),
    digestProvenance(orgId, window),
  ]);

  return c.json({ digest, links, provenance });
});

// Send (or resend) this digest by email on demand. The weekly cron auto-sends on
// Monday; this gives the user an explicit "Send by email" / "Resend" action from
// the reader so a preview — or an already-sent digest — can be delivered now.
digestsRouter.post("/:id/send", async (c) => {
  const user = c.get("user");
  const orgId = await ensureUserOrg(user.id);
  const id = c.req.param("id");

  const digest = await db.query.digests.findFirst({
    where: and(eq(digests.id, id), eq(digests.orgId, orgId)),
  });
  if (!digest) return c.json({ error: "Not found" }, 404);

  const org = await db.query.organizations.findFirst({
    where: eq(organizations.id, orgId),
    columns: { digestEmail: true },
  });
  const to = org?.digestEmail;
  if (!to) return c.json({ error: "no_recipient" }, 400);

  const isDaily = digest.period === "daily";

  // One-click feedback + unsubscribe links, signed so the email needs no session
  // (patch-21). Degrades to no links when the secret / API base isn't configured.
  const apiBase = process.env.NEXT_PUBLIC_API_URL ?? process.env.BETTER_AUTH_URL ?? "";
  const secret = process.env.BETTER_AUTH_SECRET ?? "";
  const links = apiBase && secret;
  const feedbackLinks = links
    ? {
        useful: `${apiBase}/api/digest-feedback?token=${signDigestFeedbackToken(
          { orgId, digestId: digest.id, verdict: "useful" },
          secret,
        )}`,
        notUseful: `${apiBase}/api/digest-feedback?token=${signDigestFeedbackToken(
          { orgId, digestId: digest.id, verdict: "not_useful" },
          secret,
        )}`,
      }
    : undefined;
  const unsubscribeUrl = links
    ? `${apiBase}/api/digest-feedback/unsubscribe?token=${signUnsubscribeToken(orgId, secret)}`
    : undefined;

  const webUrl = process.env.WEB_URL ?? "https://outrival.app";
  const html = renderDigestEmail(
    digest.content as DigestEmailData,
    digest.weekStart,
    digest.weekEnd,
    feedbackLinks,
    unsubscribeUrl,
    isDaily ? "Your daily competitive briefing" : "Your weekly competitive briefing",
    `${webUrl}/dashboard/digests/${digest.id}?src=digest_resend`,
  );

  try {
    await sendEmail({
      from: ALERT_FROM,
      to,
      subject: isDaily
        ? "Your Daily Competitive Briefing"
        : `Your Weekly Competitive Briefing — week of ${digest.weekStart}`,
      html,
      ...(unsubscribeUrl
        ? {
            headers: {
              "List-Unsubscribe": `<${unsubscribeUrl}>`,
              "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
            },
          }
        : {}),
    });
  } catch (err) {
    console.error("Digest send failed", { orgId, digestId: digest.id, err: String(err) });
    return c.json({ error: "send_failed" }, 502);
  }

  const sentAt = new Date();
  await db.update(digests).set({ sentAt }).where(eq(digests.id, digest.id));

  return c.json({ ok: true, sentAt: sentAt.toISOString() });
});
