import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { organizations, competitors, monitors, competitorCandidates } from "@outrival/db";
import { normalizeHostname } from "@outrival/shared";
import {
  scoreOverlap,
  ProductProfileSchema,
  buildDiscoveryQuery,
  fromDescription,
  fromDocument,
  fromRepo,
  fromUrl,
  type ProductProfile,
} from "@outrival/ai";
import { findSimilarCompanies } from "@outrival/scrapers/discovery";
import { quickFetchText } from "@outrival/scrapers/quick-fetch";
import { tasks } from "@trigger.dev/sdk/v3";
import { db } from "../lib/db";
import { authMiddleware } from "../middleware/auth";
import { ensureUserOrg } from "../lib/org";
import { fetchRepoArtifacts } from "../lib/github";
import { extractDocumentText } from "../lib/extract-document";
import {
  checkCompetitorQuota,
  getOrgPlan,
  isFrequencyAllowed,
  isSourceAllowed,
} from "../lib/plan";

type Variables = { user: { id: string } };
type ProjectStage = "idea" | "document" | "developing" | "live";

export const onboardingRouter = new Hono<{ Variables: Variables }>();

onboardingRouter.use("*", authMiddleware);

/**
 * Persist a freshly analysed profile + the stage it came from, and mark progress at
 * the "profile" step. The only auth-coupled part of each analyze-* route — the analysis
 * itself lives in pure helpers (packages/ai + lib/github + lib/extract-document), so it
 * can be reused later from a public, session-less endpoint.
 */
async function storeProfile(orgId: string, profile: ProductProfile, stage: ProjectStage) {
  await db
    .update(organizations)
    .set({
      productProfile: profile,
      projectStage: stage,
      onboardingStep: "profile",
      updatedAt: new Date(),
    })
    .where(eq(organizations.id, orgId));
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

// ── Mode: live (existing flow, renamed from /analyze) ──────────────────────
const AnalyzeUrlSchema = z.object({
  productUrl: z.string().url(),
});

onboardingRouter.post("/analyze-url", async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = AnalyzeUrlSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "Invalid body", issues: parsed.error.issues }, 400);
  }

  const user = c.get("user");
  const orgId = await ensureUserOrg(user.id);

  let text: string;
  try {
    text = await quickFetchText(parsed.data.productUrl);
  } catch (e) {
    return c.json({ error: `Fetch failed: ${String(e)}`, fallback: "description" }, 422);
  }

  if (text.length < 100) {
    return c.json({ error: "Page content too short to analyse", fallback: "description" }, 422);
  }

  const profile = await fromUrl(text);
  if (!profile) {
    return c.json({ error: "Could not derive a product profile", fallback: "description" }, 422);
  }

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

  const profile = await fromDescription(parsed.data);
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
      return c.json(
        { error: `Could not read document (${extracted.error})`, fallback: "description" },
        422,
      );
    }

    const profile = await fromDocument(extracted.value);
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

  const profile = await fromRepo(artifacts.value);
  if (!profile) {
    return c.json({ error: "Could not derive a product profile", fallback: "description" }, 422);
  }

  await storeProfile(orgId, profile, "developing");
  return c.json({ profile });
});

const DiscoverSchema = z.object({
  // Optional: idea / document / developing modes have no live product URL.
  productUrl: z.string().url().nullish(),
  profile: ProductProfileSchema,
});

onboardingRouter.post("/discover", async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = DiscoverSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "Invalid body", issues: parsed.error.issues }, 400);
  }

  let candidates: Awaited<ReturnType<typeof findSimilarCompanies>>;
  try {
    candidates = await findSimilarCompanies(
      parsed.data.productUrl ?? null,
      buildDiscoveryQuery(parsed.data.profile),
      15,
    );
  } catch (e) {
    return c.json({ error: `Discovery failed: ${String(e)}` }, 502);
  }

  if (candidates.length === 0) return c.json({ competitors: [] });

  const scored = await scoreOverlap(parsed.data.profile, candidates);
  const byUrl = new Map(scored.map((s) => [s.url, s]));

  const out = candidates
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

  return c.json({ competitors: out });
});

const PatchProfileSchema = z.object({ profile: ProductProfileSchema });

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

  return c.json({ ok: true });
});

const SourceTypeSchema = z.enum(["homepage", "pricing", "blog"]);
const FrequencySchema = z.enum(["daily", "weekly"]);

// Discovered-but-untracked competitors carried over from the discovery step so
// they can be saved as candidates instead of being lost.
const CandidateInputSchema = z.object({
  url: z.string().url(),
  title: z.string().optional(),
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
});

onboardingRouter.post("/complete", async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = CompleteSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "Invalid body", issues: parsed.error.issues }, 400);
  }

  const user = c.get("user");
  const orgId = await ensureUserOrg(user.id);
  const { selectedCompetitors, savedCandidates, dismissedCandidates, monitoringPrefs } =
    parsed.data;

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
        name: sel.name,
        url: sel.url,
        overlapScore: sel.overlapScore ?? null,
      })
      .returning();
    if (!competitor) continue;

    const monitorRows = await db
      .insert(monitors)
      .values(
        monitoringPrefs.sources.map((sourceType) => ({
          competitorId: competitor.id,
          sourceType,
          frequency: monitoringPrefs.frequency,
        })),
      )
      .returning();

    created.push({
      competitorId: competitor.id,
      monitorIds: monitorRows.map((m) => m.id),
    });

    for (const m of monitorRows) {
      try {
        await tasks.trigger("scrape-monitor", { monitorId: m.id, force: true });
      } catch (e) {
        console.error("Failed to trigger initial scrape", { monitorId: m.id, error: String(e) });
      }
    }
  }

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

  const candidateRows: Array<typeof competitorCandidates.$inferInsert> = [];
  const collectCandidate = (
    item: { url: string; title?: string; overlapScore?: number; reason?: string },
    status: "new" | "dismissed",
  ) => {
    const host = normalizeHostname(item.url);
    if (!host || knownHosts.has(host)) return;
    knownHosts.add(host);
    candidateRows.push({
      orgId,
      url: item.url,
      title: item.title ?? null,
      overlapScore: item.overlapScore ?? null,
      reason: item.reason ?? null,
      status,
      source: "onboarding",
    });
  };
  for (const item of savedCandidates) collectCandidate(item, "new");
  for (const item of dismissedCandidates) collectCandidate(item, "dismissed");
  if (candidateRows.length > 0) {
    await db.insert(competitorCandidates).values(candidateRows);
  }

  await db
    .update(organizations)
    .set({ onboardingCompleted: true, onboardingStep: "done", updatedAt: new Date() })
    .where(eq(organizations.id, orgId));

  return c.json({
    competitorsCreated: created.length,
    candidatesSaved: candidateRows.length,
    created,
  });
});
