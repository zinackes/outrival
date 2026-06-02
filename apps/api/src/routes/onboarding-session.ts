import { Hono } from "hono";
import { z } from "zod";
import { and, desc, eq, gte, notInArray } from "drizzle-orm";
import { onboardingSessions } from "@outrival/db";
import { db } from "../lib/db";
import { authMiddleware } from "../middleware/auth";
import { ensureUserOrg } from "../lib/org";

type Variables = { user: { id: string } };

export const onboardingSessionRouter = new Hono<{ Variables: Variables }>();

onboardingSessionRouter.use("*", authMiddleware);

const STAGES = [
  "started",
  "input",
  "profile",
  "discover",
  "monitoring",
  "analysis_in_progress",
  "completed",
  "abandoned",
] as const;
const StageSchema = z.enum(STAGES);
const ModeSchema = z.enum(["quick_start", "full"]);

// Stages that mean "not resumable": post-complete (the user is on the dashboard)
// or explicitly retired. The resume banner only offers a pre-complete attempt.
const NON_RESUMABLE = ["analysis_in_progress", "completed", "abandoned"] as const;

function resumeTtlCutoff(): Date {
  const days = Number(process.env.ONBOARDING_RESUME_TTL_DAYS ?? 7) || 7;
  return new Date(Date.now() - days * 86_400_000);
}

// The latest resumable session for the user, within TTL. Null when there's none.
onboardingSessionRouter.get("/current", async (c) => {
  const user = c.get("user");
  const session = await db.query.onboardingSessions.findFirst({
    where: and(
      eq(onboardingSessions.userId, user.id),
      notInArray(onboardingSessions.stage, [...NON_RESUMABLE]),
      gte(onboardingSessions.lastActivityAt, resumeTtlCutoff()),
    ),
    orderBy: desc(onboardingSessions.lastActivityAt),
  });
  return c.json({ session: session ?? null });
});

// The session whose first analysis pass is still running (post-/complete) —
// drives the dashboard progressive streaming panel. Survives a refresh, unlike a
// URL flag. GET literal registered before the PATCH/POST "/:id" handlers.
onboardingSessionRouter.get("/active-analysis", async (c) => {
  const user = c.get("user");
  const session = await db.query.onboardingSessions.findFirst({
    where: and(
      eq(onboardingSessions.userId, user.id),
      eq(onboardingSessions.stage, "analysis_in_progress"),
    ),
    orderBy: desc(onboardingSessions.lastActivityAt),
  });
  return c.json({ session: session ?? null });
});

const CreateSchema = z.object({ mode: ModeSchema.optional() });

// Start a fresh attempt. Enforces one active session per user by retiring any
// prior resumable one (so metrics + resume never see two live attempts).
onboardingSessionRouter.post("/", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const parsed = CreateSchema.safeParse(body ?? {});
  const mode = parsed.success ? (parsed.data.mode ?? "quick_start") : "quick_start";

  const user = c.get("user");
  const orgId = await ensureUserOrg(user.id);

  await db
    .update(onboardingSessions)
    .set({ stage: "abandoned", lastActivityAt: new Date() })
    .where(
      and(
        eq(onboardingSessions.userId, user.id),
        notInArray(onboardingSessions.stage, [...NON_RESUMABLE]),
      ),
    );

  const [session] = await db
    .insert(onboardingSessions)
    .values({
      userId: user.id,
      orgId,
      mode,
      stage: "started",
      timings: { started: Date.now() },
    })
    .returning();

  return c.json({ session });
});

const ProfileSchema = z.object({
  category: z.string(),
  audience: z.string(),
  valueProp: z.string(),
  pricingModel: z.string(),
});

const PatchSchema = z.object({
  stage: StageSchema.optional(),
  mode: ModeSchema.optional(),
  productUrl: z.string().url().nullish(),
  productProfile: ProfileSchema.optional(),
  discoverySuggestions: z.array(z.unknown()).optional(),
  addedCompetitorIds: z.array(z.string()).optional(),
  // Milestone timestamps (epoch ms) keyed by event name — merged into the row.
  timings: z.record(z.string(), z.number()).optional(),
});

async function ownedSession(userId: string, id: string) {
  const existing = await db.query.onboardingSessions.findFirst({
    where: eq(onboardingSessions.id, id),
  });
  return existing && existing.userId === userId ? existing : null;
}

onboardingSessionRouter.patch("/:id", async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = PatchSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "Invalid body", issues: parsed.error.issues }, 400);
  }

  const user = c.get("user");
  const existing = await ownedSession(user.id, c.req.param("id"));
  if (!existing) return c.json({ error: "Not found" }, 404);

  const d = parsed.data;
  const [session] = await db
    .update(onboardingSessions)
    .set({
      ...(d.stage !== undefined && { stage: d.stage }),
      ...(d.mode !== undefined && { mode: d.mode }),
      ...(d.productUrl !== undefined && { productUrl: d.productUrl }),
      ...(d.productProfile !== undefined && { productProfile: d.productProfile }),
      ...(d.discoverySuggestions !== undefined && {
        discoverySuggestions: d.discoverySuggestions,
      }),
      ...(d.addedCompetitorIds !== undefined && { addedCompetitorIds: d.addedCompetitorIds }),
      ...(d.timings !== undefined && {
        timings: { ...(existing.timings ?? {}), ...d.timings },
      }),
      lastActivityAt: new Date(),
    })
    .where(eq(onboardingSessions.id, existing.id))
    .returning();

  return c.json({ session });
});

// Terminal success — the first analysis pass finished (client streaming hook or
// the worker backstop). Stamps the analysis_completed milestone.
onboardingSessionRouter.post("/:id/complete", async (c) => {
  const user = c.get("user");
  const existing = await ownedSession(user.id, c.req.param("id"));
  if (!existing) return c.json({ error: "Not found" }, 404);

  const [session] = await db
    .update(onboardingSessions)
    .set({
      stage: "completed",
      completedAt: new Date(),
      lastActivityAt: new Date(),
      timings: { ...(existing.timings ?? {}), analysis_completed: Date.now() },
    })
    .where(eq(onboardingSessions.id, existing.id))
    .returning();

  return c.json({ session });
});
