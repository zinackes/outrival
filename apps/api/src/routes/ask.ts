import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { authMiddleware } from "../middleware/auth";
import { aiIntensiveRateLimit } from "../middleware/ai-intensive-rate-limit";
import { ensureUserOrg } from "../lib/org";
import { runAskAgent, type AskEvent } from "../lib/ask/agent";
import { buildAskSuggestions } from "../lib/ask/suggestions";

type Variables = { user: { id: string } };

export const askRouter = new Hono<{ Variables: Variables }>();

askRouter.use("*", authMiddleware);

// Starter prompts for the empty Ask panel — deterministic, AI-free, org-adapted, and
// rotated daily (see lib/ask/suggestions.ts). No rate limit: it's two cheap reads, no
// model call. Falls back to a static set if the reads fail or the org has no data yet.
askRouter.get("/suggestions", async (c) => {
  const orgId = await ensureUserOrg(c.get("user").id);
  const suggestions = await buildAskSuggestions(orgId).catch(() => []);
  return c.json({ suggestions });
});

// Ask Outrival — conversational intelligence over the org's own data. A bounded
// two-pass tool agent (plan → org-scoped tools → grounded synthesis), streamed over
// SSE so the UI can show the work (planning, each tool, the answer). Rate-limited like
// the other AI-intensive endpoints (10/h/user) and org-scoped end to end — the model
// only ever picks named tools; the orgId comes from the session, never from the model.
// See docs/ask-outrival.md.
askRouter.post("/", aiIntensiveRateLimit, async (c) => {
  const user = c.get("user");
  const orgId = await ensureUserOrg(user.id);

  const body = (await c.req.json().catch(() => ({}))) as { question?: unknown };
  const question = typeof body.question === "string" ? body.question.trim().slice(0, 1000) : "";
  if (!question) return c.json({ error: "question_required" }, 400);

  return streamSSE(c, async (stream) => {
    const emit = (ev: AskEvent) => stream.writeSSE({ event: ev.type, data: JSON.stringify(ev) });
    await runAskAgent(orgId, question, emit);
  });
});
