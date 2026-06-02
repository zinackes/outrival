import type { ScrapeOutcome, ScrapeOptions } from "../types";

// GitHub repo "scraper" — not a Crawlee scrape but a REST read of the repo's
// state (description, latest release, recent commits). It returns a synthesized
// document as `html` so the generic scrape-monitor pipeline (hash → snapshot →
// diff → change → classify → signal) treats repo activity like any other source.
// Used for the self-product `github_repo` source at the developing stage.

const API = "https://api.github.com";

interface RepoRef {
  owner: string;
  repo: string;
}

/** Parse `https://github.com/owner/repo[.git][/...]` → { owner, repo }. */
function parseRepo(url: string): RepoRef | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (u.hostname !== "github.com" && !u.hostname.endsWith(".github.com")) return null;
  const parts = u.pathname.split("/").filter(Boolean);
  const owner = parts[0];
  const repo = parts[1]?.replace(/\.git$/, "");
  if (!owner || !repo) return null;
  return { owner, repo };
}

function ghHeaders(): Record<string, string> {
  // User-Agent is mandatory; without it GitHub answers 403. A token (optional)
  // lifts the unauthenticated 60 req/hr limit to 5000.
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": "outrival-monitor",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  const token = process.env.GITHUB_TOKEN;
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

async function ghGet(path: string): Promise<{ status: number; json: unknown }> {
  const res = await fetch(`${API}${path}`, { headers: ghHeaders() });
  let json: unknown = null;
  try {
    json = await res.json();
  } catch {
    json = null;
  }
  return { status: res.status, json };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function str(value: unknown, key: string): string | null {
  const obj = asRecord(value);
  const v = obj?.[key];
  return typeof v === "string" ? v : null;
}

function num(value: unknown, key: string): number | null {
  const obj = asRecord(value);
  const v = obj?.[key];
  return typeof v === "number" ? v : null;
}

function bool(value: unknown, key: string): boolean {
  const obj = asRecord(value);
  return obj?.[key] === true;
}

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export async function scrape(
  _competitorId: string,
  url: string,
  _options?: ScrapeOptions,
): Promise<ScrapeOutcome> {
  const ref = parseRepo(url);
  if (!ref) throw new Error(`Not a github.com/owner/repo URL: ${url}`);
  const { owner, repo } = ref;

  const repoRes = await ghGet(`/repos/${owner}/${repo}`);
  if (repoRes.status === 404) {
    throw new Error(`GitHub repo not found or private: ${owner}/${repo}`);
  }
  if (repoRes.status !== 200) {
    throw new Error(`GitHub API returned ${repoRes.status} for ${owner}/${repo}`);
  }

  const description = str(repoRes.json, "description") ?? "";
  const defaultBranch = str(repoRes.json, "default_branch") ?? "main";
  const language = str(repoRes.json, "language");
  const stars = num(repoRes.json, "stargazers_count");
  const archived = bool(repoRes.json, "archived");

  const relRes = await ghGet(`/repos/${owner}/${repo}/releases/latest`);
  const release =
    relRes.status === 200
      ? {
          tag: str(relRes.json, "tag_name"),
          name: str(relRes.json, "name"),
          body: str(relRes.json, "body"),
        }
      : null;

  const commitsRes = await ghGet(
    `/repos/${owner}/${repo}/commits?sha=${encodeURIComponent(defaultBranch)}&per_page=10`,
  );
  const commits: Array<{ sha: string; message: string }> = [];
  if (commitsRes.status === 200 && Array.isArray(commitsRes.json)) {
    for (const item of commitsRes.json) {
      const sha = str(item, "sha");
      const message = str(asRecord(item)?.commit, "message");
      if (sha && message) {
        commits.push({ sha: sha.slice(0, 7), message: message.split("\n")[0]!.slice(0, 200) });
      }
    }
  }

  // Synthesize a stable document — meaningful repo state only. Volatile counters
  // (stars) live in metadata, never in the hashed body, so they don't churn the diff.
  const lines: string[] = [`# ${owner}/${repo}`];
  if (archived) lines.push("(archived)");
  if (description) lines.push(`Description: ${description}`);
  if (language) lines.push(`Primary language: ${language}`);
  lines.push("", "## Latest release");
  if (release) {
    lines.push(`${release.tag ?? ""}${release.name ? ` — ${release.name}` : ""}`.trim() || "(untitled)");
    if (release.body) lines.push(release.body.slice(0, 4000));
  } else {
    lines.push("(no releases)");
  }
  lines.push("", "## Recent commits");
  if (commits.length === 0) lines.push("(none)");
  for (const c of commits) lines.push(`- ${c.sha} ${c.message}`);

  const text = lines.join("\n");
  const html = `<!doctype html>\n<html><body><pre>\n${escapeHtml(text)}\n</pre></body></html>`;

  return {
    html,
    text,
    screenshotBuffer: Buffer.alloc(0),
    metadata: { url, owner, repo, stars, defaultBranch, archived },
    level: 0, // GitHub REST, no browser/proxy
    attempts: 1,
    statusCode: 200,
  };
}
