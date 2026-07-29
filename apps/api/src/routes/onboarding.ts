import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { z } from "zod";
import { captureServerEvent } from "../lib/posthog";
import { and, eq, count, inArray, isNull } from "drizzle-orm";
import {
  organizations,
  competitors,
  monitors,
  signals,
  orgNotificationPreferences,
  competitorCandidates,
  onboardingSessions,
  type SelfProfile,
  type SelfProfileField,
} from "@outrival/db";
import {
  normalizeHostname,
  validatePublicUrl,
  resolveDetectionConfig,
  deriveCompetitorName,
  withAiCache,
} from "@outrival/shared";
import {
  scoreOverlap,
  nameKnownCompetitors,
  ProductProfileSchema,
  buildDiscoveryQuery,
  fromDescription,
  fromDocument,
  fromRepo,
  type ProductProfile,
} from "@outrival/ai";
import { findSimilarCompanies } from "@outrival/scrapers/discovery";
import {
  scrapeMonitor,
  notifyOnboardingAnalysis,
  aiVisibilityTeaser,
  sendWelcomeDigest,
  USER_SCRAPE_PRIORITY,
} from "@outrival/queue";
import { db } from "../lib/db";
import { authMiddleware } from "../middleware/auth";
import { aiIntensiveRateLimit } from "../middleware/ai-intensive-rate-limit";
import { ensureUserOrg } from "../lib/org";
import { enqueueJob } from "../lib/queue";
import {
  ensurePrimaryProductForSelf,
  associateCompetitorWithScopedProduct,
  primaryProductId,
} from "../lib/products";
import { fetchRepoArtifacts } from "../lib/github";
import { extractDocumentText } from "../lib/extract-document";
import { deriveProfileFromUrl, productProfileToSelfProfile } from "../lib/profile-derivation";
import {
  checkCompetitorQuota,
  getOrgPlan,
  isFrequencyAllowed,
  isSourceAllowed,
} from "../lib/plan";

type Variables = { user: { id: string; email: string } };
type ProjectStage = "idea" | "document" | "developing" | "live";

export const onboardingRouter = new Hono<{ Variables: Variables }>();

onboardingRouter.use("*", authMiddleware);

// A profile extractor failing two ways — a parse miss (null) or a provider error
// (an empty/rate-limited completion now throws at the provider boundary) — both
// mean the same thing here: we couldn't derive a profile, so degrade to the
// manual-description fallback (`if (!profile)` → 422) instead of a bare 500.
async function deriveProfile<T>(fn: () => Promise<T | null>): Promise<T | null> {
  try {
    return await fn();
  } catch (err) {
    console.error("[onboarding] deriveProfile failed:", err);
    return null;
  }
}

/**
 * Persist a freshly analysed profile + the stage it came from, and mark progress at
 * the "profile" step. The only auth-coupled part of each analyze-* route — the analysis
 * itself lives in pure helpers (packages/ai + lib/github + lib/extract-document), so it
 * can be reused later from a public, session-less endpoint.
 */
async function storeProfile(
  orgId: string,
  profile: ProductProfile,
  stage: ProjectStage,
  repoUrl?: string | null,
) {
  await db
    .update(organizations)
    .set({
      productProfile: profile,
      projectStage: stage,
      onboardingStep: "profile",
      ...(repoUrl !== undefined && { productRepoUrl: repoUrl }),
      updatedAt: new Date(),
    })
    .where(eq(organizations.id, orgId));
}

/**
 * Patch-15: ensure the org has a "self" competitor (its own product) at EVERY stage.
 * idea/document/developing have no live URL yet — the self is still created so the user
 * can edit and track its profile manually, just without site monitors. live (a product
 * URL) additionally seeds homepage/pricing/jobs monitors at the USER_PRODUCT_RESCAN_DAYS
 * cadence and force-triggers the first scrape so the Phase 5 enrichment runs immediately.
 * Idempotent (one self per org). Seeds the editable selfProfile from the onboarding
 * productProfile (auto-detected). Monitors are activated later via POST /my-product/site.
 */
async function createSelfCompetitor(orgId: string) {
  const org = await db.query.organizations.findFirst({
    where: eq(organizations.id, orgId),
  });
  if (!org) return;

  const existingSelf = await db.query.competitors.findFirst({
    where: and(eq(competitors.orgId, orgId), eq(competitors.type, "self")),
  });
  if (existingSelf) return;

  const pp = org.productProfile;
  const selfProfile = productProfileToSelfProfile(pp);

  const [selfCompetitor] = await db
    .insert(competitors)
    .values({
      orgId,
      name: normalizeHostname(org.productUrl) ?? "My product",
      url: org.productUrl,
      category: pp?.category ?? null,
      type: "self",
      isUserProduct: true,
      selfProfile,
    })
    .returning();
  if (!selfCompetitor) return;

  // patch-28 — wrap the self-competitor in a primary product (the monitoring anchor
  // stays the self-competitor; products is the multi-SKU layer on top).
  await ensurePrimaryProductForSelf(orgId, selfCompetitor.id, selfCompetitor.name);

  // Seed the monitors matching what we can actually watch: a live site
  // (homepage/pricing/jobs) and/or a GitHub repo (developing stage). idea/document
  // have neither, so the self stays manual-only — monitors are added later via
  // POST /my-product/site or /my-product/repo.
  const rescanDays = Number(process.env.USER_PRODUCT_RESCAN_DAYS ?? 14) || 14;
  const nextRunAt = new Date(Date.now() + rescanDays * 24 * 60 * 60 * 1000);

  const monitorRows: Array<typeof monitors.$inferInsert> = [];
  if (org.productUrl) {
    // Reviews are skipped for the self-competitor (too early-stage, and G2/Capterra
    // cost a proxy call) — we simply never create review monitors for it.
    for (const sourceType of ["homepage", "pricing", "jobs"] as const) {
      monitorRows.push({ competitorId: selfCompetitor.id, sourceType, frequency: "weekly", nextRunAt });
    }
  }
  if (org.productRepoUrl) {
    monitorRows.push({
      competitorId: selfCompetitor.id,
      sourceType: "github_repo",
      frequency: "weekly",
      nextRunAt,
      config: { url: org.productRepoUrl },
    });
  }
  if (monitorRows.length === 0) return;

  const selfMonitorRows = await db.insert(monitors).values(monitorRows).returning();
  for (const m of selfMonitorRows) {
    try {
      await enqueueJob(scrapeMonitor, { monitorId: m.id, force: true }, {
        priority: USER_SCRAPE_PRIORITY,
      });
    } catch (e) {
      console.error("Failed to trigger self scrape", { monitorId: m.id, error: String(e) });
    }
  }
}

onboardingRouter.get("/status", async (c) => {
  const user = c.get("user");
  const orgId = await ensureUserOrg(user.id);

  const org = await db.query.organizations.findFirst({
    where: eq(organizations.id, orgId),
  });
  if (!org) return c.json({ error: "Not found" }, 404);

  return c.json({
    onboardingCompleted: org.onboardingCompleted,
    onboardingSkipped: org.onboardingSkipped,
    onboardingStep: org.onboardingStep,
    projectStage: org.projectStage,
    productUrl: org.productUrl,
    profile: org.productProfile,
    plan: org.plan,
  });
});

// Activation checklist (Phase B) — booleans derived from existing data, no new
// schema. Drives the dismissible checklist card on the overview.
onboardingRouter.get("/checklist", async (c) => {
  const user = c.get("user");
  const orgId = await ensureUserOrg(user.id);

  const comps = await db
    .select({ id: competitors.id, type: competitors.type })
    .from(competitors)
    .where(and(eq(competitors.orgId, orgId), isNull(competitors.deletedAt)));
  const hasSelf = comps.some((x) => x.type === "self");
  const competitorCount = comps.filter((x) => x.type !== "self").length;
  const competitorIds = comps.map((x) => x.id);

  const [monitorRows, signalRows, prefRows] = await Promise.all([
    competitorIds.length
      ? db
          .select({ v: count() })
          .from(monitors)
          .where(inArray(monitors.competitorId, competitorIds))
      : Promise.resolve([{ v: 0 }]),
    db.select({ v: count() }).from(signals).where(eq(signals.orgId, orgId)),
    db
      .select({ id: orgNotificationPreferences.id })
      .from(orgNotificationPreferences)
      .where(eq(orgNotificationPreferences.orgId, orgId))
      .limit(1),
  ]);

  const steps = [
    { key: "product", done: hasSelf },
    { key: "competitor", done: competitorCount > 0 },
    { key: "monitoring", done: (monitorRows[0]?.v ?? 0) > 0 },
    { key: "notifications", done: prefRows.length > 0 },
    { key: "signal", done: (signalRows[0]?.v ?? 0) > 0 },
  ];

  return c.json({ steps, complete: steps.every((s) => s.done) });
});

// ── Mode: live (existing flow, renamed from /analyze) ──────────────────────
const AnalyzeUrlSchema = z.object({
  productUrl: z
    .string()
    .url()
    .refine((u) => validatePublicUrl(u).ok, { message: "URL must be a public http(s) site" }),
});

onboardingRouter.post("/analyze-url", aiIntensiveRateLimit, async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = AnalyzeUrlSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "Invalid body", issues: parsed.error.issues }, 400);
  }

  const user = c.get("user");
  const orgId = await ensureUserOrg(user.id);

  // Grounded live-URL derivation (same path the add-product wizard uses): resolves
  // the competitor's dedicated pricing page (or, for catalog sites, its densest-priced
  // product page) and feeds it to the profiler so `pricingModel` is filled from a real
  // price grid instead of a homepage that rarely shows prices (it came back "" here).
  const result = await deriveProfileFromUrl(parsed.data.productUrl);
  if (!result.ok) {
    const error =
      result.reason === "fetch_failed"
        ? `Fetch failed: ${result.detail ?? "could not load the page"}`
        : result.reason === "too_short"
          ? "Page content too short to analyse"
          : "Could not derive a product profile";
    return c.json({ error, fallback: "description" }, 422);
  }
  const profile = result.profile;

  await db
    .update(organizations)
    .set({
      productUrl: parsed.data.productUrl,
      productProfile: profile,
      projectStage: "live",
      onboardingStep: "profile",
      updatedAt: new Date(),
    })
    .where(eq(organizations.id, orgId));

  return c.json({ profile });
});

// ── Mode: idea ─────────────────────────────────────────────────────────────
const AnalyzeDescriptionSchema = z.object({
  description: z.string().min(10),
  category: z.string().optional(),
  inspirations: z.array(z.string()).max(3).optional(),
});

onboardingRouter.post("/analyze-description", async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = AnalyzeDescriptionSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "Invalid body", issues: parsed.error.issues }, 400);
  }

  const user = c.get("user");
  const orgId = await ensureUserOrg(user.id);

  const profile = await deriveProfile(() => fromDescription(parsed.data));
  if (!profile) {
    return c.json({ error: "Could not derive a product profile", fallback: "description" }, 422);
  }

  await storeProfile(orgId, profile, "idea");
  return c.json({ profile });
});

// ── Mode: document (ZERO-STORAGE — extracted in memory, never written) ─────
onboardingRouter.post(
  "/analyze-document",
  bodyLimit({
    maxSize: 10 * 1024 * 1024, // 10MB
    onError: (c) => c.json({ error: "File too large (max 10MB)" }, 413),
  }),
  async (c) => {
    // Never cache the request/response carrying the document.
    c.header("Cache-Control", "no-store");

    const user = c.get("user");
    const orgId = await ensureUserOrg(user.id);

    const form = await c.req.parseBody();
    const file = form["file"];
    if (!(file instanceof File)) {
      return c.json({ error: "Missing file", fallback: "description" }, 400);
    }

    // Bytes live only in this scope; dropped when the request returns. Never logged.
    const bytes = new Uint8Array(await file.arrayBuffer());
    const extracted = await extractDocumentText(bytes, file.name, file.type);
    if (!extracted.ok) {
      // `empty`/`extract_failed` = the file parsed but carried no text layer (a
      // scanned or image-only deck) — a distinct, non-retryable cause from an AI
      // hiccup. Tag it so the client tells the user precisely instead of the
      // generic "automatic analysis didn't work out".
      return c.json(
        {
          error: `Could not read document (${extracted.error})`,
          reason: "unreadable_document",
          fallback: "description",
        },
        422,
      );
    }

    const profile = await deriveProfile(() => fromDocument(extracted.value));
    if (!profile) {
      return c.json({ error: "Could not derive a product profile", fallback: "description" }, 422);
    }

    await storeProfile(orgId, profile, "document");
    return c.json({ profile });
  },
);

// ── Mode: developing (public GitHub repo) ──────────────────────────────────
const AnalyzeRepoSchema = z.object({
  repoUrl: z.string().url(),
});

onboardingRouter.post("/analyze-repo", async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = AnalyzeRepoSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "Invalid body", issues: parsed.error.issues }, 400);
  }

  const user = c.get("user");
  const orgId = await ensureUserOrg(user.id);

  const artifacts = await fetchRepoArtifacts(parsed.data.repoUrl);
  if (!artifacts.ok) {
    const message =
      artifacts.error === "not_found"
        ? "Repo not found or private — make it public or use another mode"
        : artifacts.error === "invalid_url"
          ? "Not a valid github.com/owner/repo URL"
          : "Could not read the repo";
    return c.json({ error: message, fallback: "description" }, 422);
  }

  const profile = await deriveProfile(() => fromRepo(artifacts.value));
  if (!profile) {
    return c.json({ error: "Could not derive a product profile", fallback: "description" }, 422);
  }

  await storeProfile(orgId, profile, "developing", parsed.data.repoUrl);
  return c.json({ profile });
});

const DiscoverSchema = z.object({
  // Optional: idea / document / developing modes have no live product URL.
  productUrl: z
    .string()
    .url()
    .refine((u) => validatePublicUrl(u).ok, { message: "URL must be a public http(s) site" })
    .nullish(),
  profile: ProductProfileSchema,
  // Primary market to bias discovery toward (ISO alpha-2). Omitted/null = global.
  region: z.string().length(2).nullable().optional(),
});

// The two AI legs of discovery (nameKnownCompetitors, scoreOverlap) cache on their
// own inputs, but the Exa reads and the reachability sweep are re-paid on every
// call. The wizard re-asks the same question routinely — market toggled back and
// forth, page reloaded, a prefetch the client aborted after the server had already
// searched — so the assembled result is cached under the same identity the client
// keys its own memo on. Short TTL: a market's roster moves in weeks, and an
// onboarding attempt lasts minutes.
const DISCOVER_CACHE_TTL_SECONDS = 6 * 3600;

type DiscoveredRow = {
  url: string;
  title: string;
  snippet: string;
  overlapScore: number;
  reason: string;
};

onboardingRouter.post("/discover", async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = DiscoverSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "Invalid body", issues: parsed.error.issues }, 400);
  }

  const cacheInput = JSON.stringify({
    profile: parsed.data.profile,
    productUrl: parsed.data.productUrl ?? null,
    region: parsed.data.region ?? null,
  });

  let found: DiscoveredRow[] | null;
  try {
    const cached = await withAiCache<DiscoveredRow[] | null>(
      cacheInput,
      { namespace: "onboarding-discover", ttlSeconds: DISCOVER_CACHE_TTL_SECONDS },
      async () => {
        // Recall source #3 (Exa search + findSimilar are the other two, inside
        // findSimilarCompanies): the model names the rivals it already knows. Exa's
        // semantic reads systematically miss the market leaders for a well-known
        // product, which is what made onboarding report "no obvious competitors".
        // Best-effort — a miss just narrows the pool.
        const namedSeeds = await nameKnownCompetitors(
          parsed.data.profile,
          parsed.data.productUrl ?? null,
        ).catch(() => []);

        const candidates = await findSimilarCompanies(
          parsed.data.productUrl ?? null,
          buildDiscoveryQuery(parsed.data.profile),
          // Over-fetch: Exa ranks by query-text similarity, not competitor quality, so
          // well-known rivals (e.g. Supabase for a Postgres product) can sit past the
          // first page. Pull a wider pool, then let the LLM overlap score + sort below
          // promote the real competitors to the top.
          30,
          [],
          parsed.data.region ?? null,
          namedSeeds,
        );

        // Null, not []: an empty pool is the one result a user retries on the spot
        // (they widen the market, then ask again), and withAiCache stores anything
        // non-null — freezing "no competitors found" for the whole TTL.
        if (candidates.length === 0) return null;

        const scored = await scoreOverlap(parsed.data.profile, candidates);
        const byUrl = new Map(scored.map((s) => [s.url, s]));

        return candidates
          .map((c) => {
            const s = byUrl.get(c.url);
            return {
              url: c.url,
              title: c.title,
              snippet: c.snippet,
              overlapScore: s?.overlapScore ?? 0,
              reason: s?.reason ?? "",
            };
          })
          .sort((a, b) => b.overlapScore - a.overlapScore);
      },
    );
    found = cached.value;
  } catch (e) {
    return c.json({ error: `Discovery failed: ${String(e)}` }, 502);
  }

  return c.json({ competitors: found ?? [] });
});

// Keep the My Product self-profile in step with the org product profile when the
// update modal saves (patch: dual-profile sync). Only the three fields both
// profiles share are mirrored — features/techStack/pricingTiers stay self-only and
// pricingModel stays org-only. Stickiness: a field the user manually typed freezes
// against future auto-scans (isFromAutoDetect=false); a value merely accepted from a
// re-analysis stays auto-detected. Unchanged fields keep their prior sticky state.
// No-op during first-time onboarding (the self-competitor doesn't exist until
// /complete). Best-effort: never blocks the profile save.
const SELF_SHARED_FIELDS = ["category", "audience", "valueProp"] as const;
type SelfSharedField = (typeof SELF_SHARED_FIELDS)[number];

async function syncSelfProfile(
  orgId: string,
  profile: ProductProfile,
  manualFields: Set<string>,
) {
  const self = await db.query.competitors.findFirst({
    where: and(eq(competitors.orgId, orgId), eq(competitors.type, "self")),
  });
  if (!self) return;

  const prev = (self.selfProfile ?? {}) as SelfProfile;
  const next: SelfProfile = { ...prev };
  const now = new Date().toISOString();

  for (const key of SELF_SHARED_FIELDS) {
    const value = profile[key]?.trim() ?? "";
    const prevField = prev[key] as SelfProfileField<string> | undefined;
    // Don't wipe an existing self value with an empty incoming one.
    if (!value) continue;
    // Unchanged value → preserve its current sticky state untouched.
    if (prevField && prevField.value === value) continue;
    const isManual = manualFields.has(key);
    next[key] = {
      value,
      isFromAutoDetect: !isManual,
      lastEditedByUserAt: isManual ? now : null,
    };
  }

  await db
    .update(competitors)
    .set({ selfProfile: next, category: profile.category?.trim() || self.category, updatedAt: new Date() })
    .where(eq(competitors.id, self.id));
}

const PatchProfileSchema = z.object({
  profile: ProductProfileSchema,
  // Fields the user manually typed (vs merely accepted from a re-analysis). Drives
  // self-profile stickiness on sync. Absent during onboarding → treated as none.
  manualFields: z.array(z.enum(SELF_SHARED_FIELDS)).optional(),
});

onboardingRouter.patch("/profile", async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = PatchProfileSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "Invalid body", issues: parsed.error.issues }, 400);
  }

  const user = c.get("user");
  const orgId = await ensureUserOrg(user.id);

  await db
    .update(organizations)
    .set({ productProfile: parsed.data.profile, updatedAt: new Date() })
    .where(eq(organizations.id, orgId));

  await syncSelfProfile(
    orgId,
    parsed.data.profile,
    new Set<SelfSharedField>(parsed.data.manualFields ?? []),
  );

  return c.json({ profile: parsed.data.profile });
});

// ── Progress persistence (resume after tab close) ──────────────────────────
const ProgressSchema = z.object({
  step: z.enum(["stage", "input", "profile", "discover", "monitoring", "done"]),
});

onboardingRouter.patch("/progress", async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = ProgressSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "Invalid body", issues: parsed.error.issues }, 400);
  }

  const user = c.get("user");
  const orgId = await ensureUserOrg(user.id);

  await db
    .update(organizations)
    .set({ onboardingStep: parsed.data.step, updatedAt: new Date() })
    .where(eq(organizations.id, orgId));

  return c.json({ ok: true });
});

// ── Skip (leave for now) ───────────────────────────────────────────────────
onboardingRouter.post("/skip", async (c) => {
  const user = c.get("user");
  const orgId = await ensureUserOrg(user.id);

  await db
    .update(organizations)
    .set({ onboardingSkipped: true, onboardingCompleted: true, updatedAt: new Date() })
    .where(eq(organizations.id, orgId));

  void captureServerEvent(user.id, "onboarding_skipped", { orgId });

  return c.json({ ok: true });
});

const SourceTypeSchema = z.enum(["homepage", "pricing", "blog"]);
const FrequencySchema = z.enum(["daily", "weekly"]);

// Discovered-but-untracked competitors carried over from the discovery step so
// they can be saved as candidates instead of being lost.
const CandidateInputSchema = z.object({
  url: z.string().url(),
  title: z.string().optional(),
  // The discovery step already showed this text (Exa's page extract); carrying it
  // over is what gives the day-one Discovery queue a description per candidate.
  snippet: z.string().max(2000).optional(),
  overlapScore: z.number().min(0).max(100).optional(),
  reason: z.string().optional(),
});

const CompleteSchema = z.object({
  selectedCompetitors: z
    .array(
      z.object({
        name: z.string().min(1),
        url: z.string().url(),
        overlapScore: z.number().min(0).max(100).optional(),
      }),
    )
    .min(1),
  // Left unchecked → saved as "new" candidates. Trashed → saved as "dismissed"
  // (remembered rejection, so the weekly detection won't re-suggest them).
  savedCandidates: z.array(CandidateInputSchema).max(50).optional().default([]),
  dismissedCandidates: z.array(CandidateInputSchema).max(50).optional().default([]),
  monitoringPrefs: z.object({
    frequency: FrequencySchema,
    sources: z.array(SourceTypeSchema).min(1),
  }),
  // Primary market chosen at the discover step (ISO alpha-2). Persisted into the
  // org's detectionConfig so the weekly cron + on-demand detect inherit it. null =
  // global; undefined = leave the existing config untouched.
  discoveryRegion: z.string().length(2).nullable().optional(),
  // Patch-25: the resumable session for this run, flipped to analysis_in_progress
  // so the dashboard streaming panel knows the first pass is underway.
  onboardingSessionId: z.string().optional(),
});

onboardingRouter.post("/complete", async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = CompleteSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "Invalid body", issues: parsed.error.issues }, 400);
  }

  const user = c.get("user");
  const orgId = await ensureUserOrg(user.id);
  const {
    selectedCompetitors,
    savedCandidates,
    dismissedCandidates,
    monitoringPrefs,
    discoveryRegion,
    onboardingSessionId,
  } = parsed.data;

  const plan = await getOrgPlan(orgId);

  if (!isFrequencyAllowed(plan, monitoringPrefs.frequency)) {
    return c.json(
      { error: "plan_locked_frequency", frequency: monitoringPrefs.frequency, plan },
      403,
    );
  }
  const lockedSource = monitoringPrefs.sources.find((s) => !isSourceAllowed(plan, s));
  if (lockedSource) {
    return c.json({ error: "plan_locked_source", source: lockedSource, plan }, 403);
  }

  const quota = await checkCompetitorQuota(orgId, plan, selectedCompetitors.length);
  if (!quota.allowed) {
    return c.json(
      {
        error: "plan_limit_competitors",
        used: quota.used,
        limit: quota.limit,
        requested: selectedCompetitors.length,
        plan,
      },
      403,
    );
  }

  const created: Array<{ competitorId: string; monitorIds: string[] }> = [];

  for (const sel of selectedCompetitors) {
    const [competitor] = await db
      .insert(competitors)
      .values({
        orgId,
        // The discovery step carries the page <title>, which is a tagline more
        // often than a company name. Derive the brand here rather than trusting
        // the client's label.
        name: deriveCompetitorName(sel.url, sel.name),
        url: sel.url,
        overlapScore: sel.overlapScore ?? null,
      })
      .returning();
    if (!competitor) continue;

    // Stamp scrapeStartedAt so the competitor page shows the first scrape as
    // in-progress on landing (isServerScraping derives "running" from it).
    const scrapeStartedAt = new Date();
    const monitorRows = await db
      .insert(monitors)
      .values([
        ...monitoringPrefs.sources.map((sourceType) => ({
          competitorId: competitor.id,
          sourceType,
          frequency: monitoringPrefs.frequency,
          scrapeStartedAt,
        })),
        // Internal news anchor (never user-selectable, not plan-gated) — mirrors
        // the manual-creation path so the day-0 landscape has dated events
        // (funding, launches, press) to show from the very first scrape.
        {
          competitorId: competitor.id,
          sourceType: "news" as const,
          frequency: "weekly" as const,
          scrapeStartedAt,
        },
        // Internal subdomains anchor (weekly) — Certificate Transparency (crt.sh);
        // its live-subdomain diff surfaces expansion / pre-launch surfaces. Weekly
        // (not daily) — see competitors.ts POST: CT logs are slow + crt.sh is a
        // shared, flaky provider that 429s under a daily × N-competitor load.
        {
          competitorId: competitor.id,
          sourceType: "subdomains" as const,
          frequency: "weekly" as const,
          scrapeStartedAt,
        },
        // Internal YouTube anchor (weekly) — channel resolved from a homepage link;
        // its sorted video-list diff surfaces brand-new uploads as content signals.
        {
          competitorId: competitor.id,
          sourceType: "youtube" as const,
          frequency: "weekly" as const,
          scrapeStartedAt,
        },
        // Internal Hacker News anchor (weekly) — HN Algolia by brand; its objectID-set
        // diff surfaces Show HN launches (product/high) / traction mentions (content/medium).
        {
          competitorId: competitor.id,
          sourceType: "hackernews" as const,
          frequency: "weekly" as const,
          scrapeStartedAt,
        },
        // Internal well-known anchor (weekly) — /.well-known app-association files +
        // llms.txt; its fingerprint diff surfaces a mobile-app launch / an llms.txt manifest.
        {
          competitorId: competitor.id,
          sourceType: "wellknown" as const,
          frequency: "weekly" as const,
          scrapeStartedAt,
        },
      ])
      .returning();

    created.push({
      competitorId: competitor.id,
      monitorIds: monitorRows.map((m) => m.id),
    });

    for (const m of monitorRows) {
      try {
        await enqueueJob(scrapeMonitor, { monitorId: m.id, force: true }, {
          priority: USER_SCRAPE_PRIORITY,
        });
      } catch (e) {
        console.error("Failed to trigger initial scrape", { monitorId: m.id, error: String(e) });
      }
    }
  }

  // Patch-12: create the "self" competitor — the user's own product, monitored
  // with the same Phase 5 pipeline but excluded from the competitor list, quotas
  // and discovery. Only when we have a URL to scrape (live/developing modes);
  // idea/document onboarding has none, so no self-competitor is created yet. When
  // the user later re-onboards with a URL, /complete runs again and creates it.
  // Idempotent: never create a second self for the same org.
  await createSelfCompetitor(orgId);

  // patch-28 — link the discovery-added competitors to the org's primary product so
  // their signals are tagged into its feed (createSelfCompetitor created the product
  // just above, so the primary now exists). Shared by default; reclassify later.
  for (const c of created) {
    await associateCompetitorWithScopedProduct(orgId, c.competitorId);
  }

  const orgRow = await db.query.organizations.findFirst({
    where: eq(organizations.id, orgId),
    columns: { digestEmail: true, detectionConfig: true },
  });
  const detectionCfg = resolveDetectionConfig(orgRow?.detectionConfig);

  // Save the discovered-but-untracked competitors as candidates so they remain
  // reachable in Detections (e.g. to track after a plan upgrade). Dedup by
  // hostname against the competitors we just created and any candidate already
  // recorded for this org.
  const knownHosts = new Set<string>();
  for (const sel of selectedCompetitors) {
    const h = normalizeHostname(sel.url);
    if (h) knownHosts.add(h);
  }
  const existingCandidates = await db.query.competitorCandidates.findMany({
    where: eq(competitorCandidates.orgId, orgId),
  });
  for (const cand of existingCandidates) {
    const h = normalizeHostname(cand.url);
    if (h) knownHosts.add(h);
  }

  // patch-28 — tag onboarding candidates onto the primary product (just created by
  // createSelfCompetitor) so they surface in its product-scoped discovery queue.
  const onboardingProductId = await primaryProductId(orgId);
  const candidateRows: Array<typeof competitorCandidates.$inferInsert> = [];
  const collectCandidate = (
    item: {
      url: string;
      title?: string;
      snippet?: string;
      overlapScore?: number;
      reason?: string;
    },
    status: "new" | "dismissed",
  ) => {
    const host = normalizeHostname(item.url);
    if (!host || knownHosts.has(host)) return;
    knownHosts.add(host);
    candidateRows.push({
      orgId,
      productId: onboardingProductId,
      url: item.url,
      title: item.title ?? null,
      snippet: item.snippet ?? null,
      overlapScore: item.overlapScore ?? null,
      reason: item.reason ?? null,
      status,
      source: "onboarding",
    });
  };
  // Every leftover the user saw is persisted, whatever it scored. `minOverlap`
  // (default 65) is the WEEKLY DETECTION's auto-notification bar — the score above
  // which a candidate is worth interrupting someone for. Reusing it here as an
  // admission bar deleted the rest: a niche product's real competitors routinely
  // score 50-64, and the user had already looked at them during discovery, so they
  // vanished between the last onboarding screen and the Discovery queue with no
  // trace and no way back. On-demand discovery never applied it either
  // (`ON_DEMAND_MIN_OVERLAP` = 20, apps/api/src/lib/detect-candidates.ts), so the
  // two paths disagreed about the same Exa results.
  // The queue is a REVIEWABLE picklist, not a notification: discovery-view ranks by
  // score and collapses everything under 60 into a weak band with a bulk dismiss,
  // which is where a low or unscored leftover belongs. Junk lands there instead of
  // being dropped silently (2026-07-10 audit: 323 prod rows averaging overlap 42).
  for (const item of savedCandidates) collectCandidate(item, "new");
  // Dismissals are the anti-re-suggestion memory — saved regardless of score,
  // or the weekly detection would re-propose exactly what the user trashed.
  for (const item of dismissedCandidates) collectCandidate(item, "dismissed");
  if (candidateRows.length > 0) {
    await db.insert(competitorCandidates).values(candidateRows);
  }

  // Persist the chosen market into detectionConfig (merged over the resolved
  // current config) so later cron / on-demand discovery biases the same way.
  let detectionConfigUpdate: Record<string, unknown> | undefined;
  if (discoveryRegion !== undefined) {
    detectionConfigUpdate = {
      detectionConfig: {
        ...detectionCfg,
        region: discoveryRegion,
      },
    };
  }

  await db
    .update(organizations)
    .set({
      onboardingCompleted: true,
      onboardingStep: "done",
      // The weekly/daily briefings are the product's retention loop, yet nothing
      // ever set their recipient (1/33 prod orgs had one — the rest silently got
      // no email). Default to the account email at completion; Settings can
      // change or clear it, and every send carries one-click unsubscribe.
      ...(orgRow?.digestEmail || !user.email ? {} : { digestEmail: user.email }),
      ...detectionConfigUpdate,
      updatedAt: new Date(),
    })
    .where(eq(organizations.id, orgId));

  // Flip the resumable session to analysis_in_progress (drives the dashboard
  // streaming panel). Ownership-guarded; backfills orgId if it was null.
  if (onboardingSessionId) {
    await db
      .update(onboardingSessions)
      .set({ stage: "analysis_in_progress", orgId, lastActivityAt: new Date() })
      .where(
        and(
          eq(onboardingSessions.id, onboardingSessionId),
          eq(onboardingSessions.userId, user.id),
        ),
      );
  }

  // Watch the first analysis pass and ping the user (in-app notification) once
  // every competitor has an AI summary — so they can leave the onboarding "done"
  // screen for the dashboard instead of waiting. Idempotency-keyed per org so a
  // re-run of /complete doesn't spawn a second watcher.
  if (created.length > 0) {
    try {
      await enqueueJob(
        notifyOnboardingAnalysis,
        { orgId, competitorIds: created.map((c) => c.competitorId) },
        { singletonKey: `onboarding-analysis-${orgId}` },
      );
    } catch (e) {
      console.error("Failed to trigger onboarding analysis watcher", {
        orgId,
        error: String(e),
      });
    }
  }

  // AI Visibility teaser (Lever 7): a one-time free "share of model" taste at day 0.
  // Best-effort, self-guarded (one row per org), no-ops without an engine key — fire
  // and forget. Needs competitors for the comparative framing.
  if (created.length > 0) {
    try {
      await enqueueJob(
        aiVisibilityTeaser,
        { orgId },
        { singletonKey: `ai-visibility-teaser-${orgId}` },
      );
    } catch (e) {
      console.error("Failed to trigger ai-visibility teaser", { orgId, error: String(e) });
    }
  }

  // Welcome digest (Lever 5 brick 1): "here's your starting position". Idempotency-keyed
  // per org so a re-run of /complete doesn't double-send. Best-effort.
  try {
    await enqueueJob(
      sendWelcomeDigest,
      { orgId },
      { singletonKey: `welcome-digest-${orgId}` },
    );
  } catch (e) {
    console.error("Failed to trigger welcome digest", { orgId, error: String(e) });
  }

  void captureServerEvent(user.id, "onboarding_completed", {
    competitorsCreated: created.length,
    sources: monitoringPrefs.sources,
    frequency: monitoringPrefs.frequency,
    orgId,
  });

  return c.json({
    competitorsCreated: created.length,
    candidatesSaved: candidateRows.length,
    created,
  });
});
