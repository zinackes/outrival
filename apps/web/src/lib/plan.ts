import { PLANS, type Plan } from "@outrival/shared";

/**
 * Normalize the workspace plan string threaded through the dashboard shell into a
 * real `Plan` key. The layout falls back to the literal `"Free"` when the billing
 * read fails, and the API echoes lowercase keys, so the raw value is neither
 * guaranteed to be a plan key nor lowercase.
 *
 * Anything unrecognized resolves to `"free"` — the plan with the fewest features.
 * Gating on it can only ever hide a feature the user might have, never surface one
 * they don't; every gated surface keeps its own server-side lock behind the link.
 */
export function resolvePlan(raw?: string | null): Plan {
  const key = (raw ?? "").trim().toLowerCase();
  return (PLANS as readonly string[]).includes(key) ? (key as Plan) : "free";
}
