import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { and, desc, eq } from "drizzle-orm";
import { askHistory } from "@outrival/db";
import { db } from "../lib/db";
import { authMiddleware } from "../middleware/auth";
import { aiIntensiveRateLimit } from "../middleware/ai-intensive-rate-limit";
import { ensureUserOrg } from "../lib/org";
import { runAskAgent, type AskEvent, type AskPageContext } from "../lib/ask/agent";
import { buildAskSuggestions } from "../lib/ask/suggestions";
import { captureServerEvent } from "../lib/posthog";

type Variables = { user: { id: string } };

export const askRouter = new Hono<{ Variables: Variables }>();

askRouter.use("*", authMiddleware);

// The page context the question is asked from. Validated here — the model never sees
// raw client input untrimmed, and competitorId is only a hint (every tool still
// re-resolves it within the org, so a forged id yields nothing).
function parseAskContext(raw: unknown): AskPageContext | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as { label?: unknown; competitorId?: unknown };
  const label = typeof r.label === "string" ? r.label.trim().slice(0, 200) : "";
  if (!label) return null;
  return {
    label,
    competitorId: typeof r.competitorId === "string" ? r.competitorId : undefined,
  };
}

// Starter prompts for the empty Ask panel — deterministic, AI-free, org-adapted, and
// rotated daily (see lib/ask/suggestions.ts). No rate limit: it's two cheap reads, no
// model call. Falls back to a static set if the reads fail or the org has no data yet.
askRouter.get("/suggestions", async (c) => {
  const orgId = await ensureUserOrg(c.get("user").id);
  const suggestions = await buildAskSuggestions(orgId).catch(() => []);
  return c.json({ suggestions });
});

// Consultable history of the user's own past questions (per org+user). No rate limit:
// a single indexed DB read, like /suggestions. Returns the stored answer + citations so
// the UI can re-display a past exchange without spending another model call.
askRouter.get("/history", async (c) => {
  const user = c.get("user");
  const orgId = await ensureUserOrg(user.id);
  const limit = Math.min(Math.max(Number(c.req.query("limit") ?? 20), 1), 50);
  const history = await db.query.askHistory
    .findMany({
      where: and(eq(askHistory.orgId, orgId), eq(askHistory.userId, user.id)),
      orderBy: desc(askHistory.createdAt),
      limit,
      columns: {
        id: true,
        question: true,
        answer: true,
        citations: true,
        context: true,
        createdAt: true,
      },
    })
    .catch(() => []);
  return c.json({ history });
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

  const body = (await c.req.json().catch(() => ({}))) as {
    question?: unknown;
    context?: unknown;
  };
  const question = typeof body.question === "string" ? body.question.trim().slice(0, 1000) : "";
  if (!question) return c.json({ error: "question_required" }, 400);
  const context = parseAskContext(body.context);

  void captureServerEvent(user.id, "ask_query_submitted", {
    orgId,
    questionLength: question.length,
    scoped: Boolean(context),
  });

  // Disable reverse-proxy response buffering (nginx/Traefik) so streamed answer
  // tokens reach the client immediately instead of arriving in one late burst.
  c.header("X-Accel-Buffering", "no");

  return streamSSE(c, async (stream) => {
    const emit = (ev: AskEvent) => stream.writeSSE({ event: ev.type, data: JSON.stringify(ev) });
    await runAskAgent(orgId, user.id, question, context, emit);
  });
});
