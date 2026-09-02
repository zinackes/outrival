import { isSafeWebhookUrl } from "./webhook/sign";

const MAX_REDIRECTS = 5;

/**
 * POST a Slack-shaped payload to a user-supplied webhook URL. Same SSRF stance as
 * `sendWebhook`: redirects followed MANUALLY with `isSafeWebhookUrl` re-run on every
 * hop, because a host that passed validation at save time can 3xx toward an internal
 * address at send time (code:SEC-04). Throws on an unsafe hop, too many redirects or
 * a non-2xx; the two wrappers below choose whether that surfaces.
 */
async function postSlack(webhookUrl: string, text: string): Promise<void> {
  let target = webhookUrl;
  for (let hop = 0; ; hop++) {
    if (!isSafeWebhookUrl(target)) throw new Error("Slack webhook rejected: unsafe_url");
    const res = await fetch(target, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
      redirect: "manual",
      signal: AbortSignal.timeout(8000),
    });
    const location = res.headers.get("location");
    if (res.status >= 300 && res.status < 400 && location) {
      if (hop >= MAX_REDIRECTS) throw new Error("Slack webhook rejected: too_many_redirects");
      target = new URL(location, target).toString();
      continue;
    }
    if (!res.ok) {
      throw new Error(`Slack webhook failed: ${res.status} ${await res.text().catch(() => "")}`);
    }
    return;
  }
}

/** Best-effort ping (ops alerts, digests): a dead webhook never fails the caller. */
export async function sendSlackMessage(webhookUrl: string, text: string): Promise<void> {
  if (!webhookUrl) return;
  try {
    await postSlack(webhookUrl, text);
  } catch {
    // ne jamais faire échouer l'action principale à cause d'une notif
  }
}

/** Same send, surfacing the failure so a pg-boss job retries instead of silently dropping. */
export async function sendSlackMessageOrThrow(webhookUrl: string, text: string): Promise<void> {
  await postSlack(webhookUrl, text);
}
