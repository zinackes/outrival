import { Hono } from "hono";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { organizations, competitors, monitors } from "@outrival/db";
import { analyzeProduct, scoreOverlap, ProductProfileSchema } from "@outrival/ai";
import { findSimilarCompanies } from "@outrival/scrapers/discovery";
import { quickFetchText } from "@outrival/scrapers/quick-fetch";
import { tasks } from "@trigger.dev/sdk/v3";
import { db } from "../lib/db";
import { authMiddleware } from "../middleware/auth";
import { ensureUserOrg } from "../lib/org";

type Variables = { user: { id: string } };

export const onboardingRouter = new Hono<{ Variables: Variables }>();

onboardingRouter.use("*", authMiddleware);

const AnalyzeSchema = z.object({
  productUrl: z.string().url(),
});

onboardingRouter.post("/analyze", async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = AnalyzeSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "Invalid body", issues: parsed.error.issues }, 400);
  }

  const user = c.get("user");
  const orgId = await ensureUserOrg(user.id);

  let text: string;
  try {
    text = await quickFetchText(parsed.data.productUrl);
  } catch (e) {
    return c.json({ error: `Fetch failed: ${String(e)}` }, 502);
  }

  if (text.length < 100) {
    return c.json({ error: "Page content too short to analyse" }, 422);
  }

  const profile = await analyzeProduct(text);
  if (!profile) {
    return c.json({ error: "Could not derive a product profile" }, 422);
  }

  await db
    .update(organizations)
    .set({ productUrl: parsed.data.productUrl, productProfile: profile, updatedAt: new Date() })
    .where(eq(organizations.id, orgId));

  return c.json({ profile });
});

const DiscoverSchema = z.object({
  productUrl: z.string().url(),
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
    candidates = await findSimilarCompanies(parsed.data.productUrl, 15);
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

const SourceTypeSchema = z.enum(["homepage", "pricing", "blog"]);
const FrequencySchema = z.enum(["daily", "weekly"]);

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
  const { selectedCompetitors, monitoringPrefs } = parsed.data;

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

  await db
    .update(organizations)
    .set({ onboardingCompleted: true, updatedAt: new Date() })
    .where(eq(organizations.id, orgId));

  return c.json({ competitorsCreated: created.length, created });
});
