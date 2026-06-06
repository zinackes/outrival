import type { ScrapeOutcome, ScrapeOptions } from "../types";

/**
 * Status-page connector (patch-31). Statuspage / Instatus expose a public JSON
 * summary (`/api/v2/summary.json` resp. `/summary.json`) — overall indicator,
 * per-component status, and active incidents. We fetch it (pure `fetch`, no
 * browser/proxy) and render a STABLE document the normal snapshot → diff →
 * classify pipeline consumes unchanged, so a new/cleared incident becomes a change
 * → signal like any other source. The status host comes from the detected platform
 * profile (`statusPage`), falling back to the monitor URL.
 */

const FETCH_TIMEOUT_MS = 8000;
const USER_AGENT = "Mozilla/5.0 (compatible; OutrivalBot/1.0; +https://outrival.io/bot)";

interface StatusSummary {
  page?: { name?: unknown };
  status?: { indicator?: unknown; description?: unknown };
  components?: { name?: unknown; status?: unknown }[];
  incidents?: { name?: unknown; status?: unknown; impact?: unknown }[];
}

function str(x: unknown): string {
  return typeof x === "string" ? x.trim() : "";
}

/** Resolve the status host from the profile value ("statuspage:<host>" /
 *  "instatus:<slug>") or the monitor URL. Null when nothing usable. Exported for tests. */
export function resolveHost(url: string, profileValue: string | undefined): { host: string; instatus: boolean } | null {
  if (profileValue) {
    const idx = profileValue.indexOf(":");
    const kind = idx > 0 ? profileValue.slice(0, idx) : "";
    const rest = idx > 0 ? profileValue.slice(idx + 1) : "";
    if (rest) {
      if (kind === "instatus") return { host: `${rest}.instatus.com`, instatus: true };
      if (kind === "statuspage" && rest !== "statuspage") return { host: rest, instatus: false };
    }
  }
  try {
    const host = new URL(url.includes("://") ? url : `https://${url}`).host;
    return host ? { host, instatus: host.endsWith(".instatus.com") } : null;
  } catch {
    return null;
  }
}

// Stable, diff-friendly rendering: overall status, components sorted by name, and
// active incidents. Deterministic order so unchanged status hashes identically.
// Exported for tests.
export function render(data: StatusSummary, host: string): { html: string; text: string } {
  const lines: string[] = [];
  const pageName = str(data.page?.name) || host;
  lines.push(`Status page: ${pageName}`);
  const indicator = str(data.status?.indicator) || "unknown";
  const description = str(data.status?.description);
  lines.push(`Overall: ${indicator}${description ? ` — ${description}` : ""}`);

  const components = (data.components ?? [])
    .map((c) => ({ name: str(c.name), status: str(c.status) }))
    .filter((c) => c.name)
    .sort((a, b) => a.name.localeCompare(b.name));
  if (components.length > 0) {
    lines.push("", "Components:");
    for (const c of components) lines.push(`- ${c.name}: ${c.status || "operational"}`);
  }

  const incidents = (data.incidents ?? [])
    .map((i) => ({ name: str(i.name), status: str(i.status), impact: str(i.impact) }))
    .filter((i) => i.name)
    .sort((a, b) => a.name.localeCompare(b.name));
  if (incidents.length > 0) {
    lines.push("", "Active incidents:");
    for (const i of incidents) {
      lines.push(`- ${i.name} [${i.impact || "none"}/${i.status || "investigating"}]`);
    }
  }

  const text = lines.join("\n");
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const html = `<!doctype html><html><head><title>${esc(pageName)} status</title></head><body><pre>${esc(text)}</pre></body></html>`;
  return { html, text };
}

export async function scrape(
  _competitorId: string,
  url: string,
  options: ScrapeOptions = {},
): Promise<ScrapeOutcome> {
  const resolved = resolveHost(url, options.platformProfile?.statusPage?.value);
  if (!resolved) throw new Error(`status: no resolvable status host from ${url}`);

  const summaryUrl = resolved.instatus
    ? `https://${resolved.host}/summary.json`
    : `https://${resolved.host}/api/v2/summary.json`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(summaryUrl, {
      redirect: "follow",
      signal: controller.signal,
      headers: { "user-agent": USER_AGENT, accept: "application/json" },
    });
    if (!res.ok) throw new Error(`status: ${summaryUrl} → HTTP ${res.status}`);
    const data = (await res.json()) as StatusSummary;
    const { html, text } = render(data, resolved.host);
    return {
      html,
      text,
      screenshotBuffer: Buffer.alloc(0),
      metadata: { url: summaryUrl, scrapedWith: "status-api" },
      statusCode: res.status,
      etag: res.headers.get("etag") ?? undefined,
      lastModified: res.headers.get("last-modified") ?? undefined,
      level: 0,
      attempts: 1,
    };
  } finally {
    clearTimeout(timer);
  }
}
