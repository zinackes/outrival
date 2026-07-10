import { Hono } from "hono";
import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { env } from "../env";
import { runAskAgent, type AskEvent } from "../lib/ask/agent";

// Worker→API internal surface. The Ask agent + its org-scoped tool registry are
// API-private (workers cannot import apps/api), so standing-query re-evaluation
// re-runs a question THROUGH the same pipeline via this endpoint instead of growing
// a second Q&A path. Auth = shared secret header; INTERNAL_API_SECRET unset → 404
// on everything (the feature degrades to "saved but never re-evaluated").

export const internalRouter = new Hono();

function secretMatches(provided: string | undefined): boolean {
  const secret = env.INTERNAL_API_SECRET;
  if (!secret || !provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

internalRouter.use("*", async (c, next) => {
  if (!secretMatches(c.req.header("x-internal-secret"))) {
    // Indistinguishable from an unmounted route — no oracle for secret probing.
    return c.json({ error: "not_found" }, 404);
  }
  await next();
});

const RunSchema = z.object({
  orgId: z.string().min(1),
  userId: z.string().min(1),
  question: z.string().trim().min(1).max(1000),
  context: z
    .object({
      label: z.string().trim().min(1).max(200),
      competitorId: z.string().max(64).optional(),
    })
    .nullish(),
});

// Headless Ask run: same two-pass agent, no SSE, no history row. Returns the final
// grounded answer + validated citations, or 502 when the agent couldn't ground one
// (the caller then leaves the standing query's state untouched).
internalRouter.post("/ask/run", async (c) => {
  const parsed = RunSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: "invalid_body" }, 400);
  const { orgId, userId, question, context } = parsed.data;

  const events: AskEvent[] = [];
  await runAskAgent(
    orgId,
    userId,
    question,
    context ?? null,
    (ev) => {
      events.push(ev);
    },
    { persistHistory: false },
  );

  const final = events.find(
    (e): e is Extract<AskEvent, { type: "answer" }> => e.type === "answer",
  );
  const failed = events.some((e) => e.type === "error");
  if (failed || !final || final.grounded === false) {
    return c.json({ error: "ask_failed" }, 502);
  }
  return c.json({ answer: final.answer, citations: final.citations });
});
