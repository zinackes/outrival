import { type Result, ok, err } from "@outrival/shared";
import type { RepoArtifacts } from "@outrival/ai";

/**
 * Fetch public repo artefacts from the unauthenticated GitHub API (60 req/h, fine for
 * MVP onboarding). No SDK. Pure of auth/session — usable from a future public endpoint.
 *
 * Returns a domain Result: a missing/private repo (404) surfaces as a typed error so
 * the route can answer 422 + fallback rather than throwing.
 */
export type RepoError = "invalid_url" | "not_found" | "fetch_failed";

const API = "https://api.github.com";

interface ParsedRepo {
  owner: string;
  repo: string;
}

export function parseGitHubUrl(input: string): ParsedRepo | null {
  let u: URL;
  try {
    u = new URL(input.trim());
  } catch {
    return null;
  }
  if (u.hostname !== "github.com" && u.hostname !== "www.github.com") return null;
  const parts = u.pathname.split("/").filter(Boolean);
  if (parts.length < 2) return null;
  const owner = parts[0]!;
  const repo = parts[1]!.replace(/\.git$/, "");
  if (!owner || !repo) return null;
  return { owner, repo };
}

const HEADERS = {
  Accept: "application/vnd.github+json",
  "User-Agent": "outrival-onboarding",
  "X-GitHub-Api-Version": "2022-11-28",
};

async function ghJson<T>(path: string): Promise<T | null> {
  const res = await fetch(`${API}${path}`, { headers: HEADERS });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`GitHub ${res.status} for ${path}`);
  return (await res.json()) as T;
}

/** Decode a GitHub `contents` API file payload (base64) to UTF-8 text. */
function decodeContent(payload: { content?: string; encoding?: string } | null): string | null {
  if (!payload?.content) return null;
  if (payload.encoding && payload.encoding !== "base64") return null;
  try {
    return Buffer.from(payload.content, "base64").toString("utf-8");
  } catch {
    return null;
  }
}

export async function fetchRepoArtifacts(
  repoUrl: string,
): Promise<Result<RepoArtifacts, RepoError>> {
  const parsed = parseGitHubUrl(repoUrl);
  if (!parsed) return err("invalid_url");
  const { owner, repo } = parsed;

  try {
    // Repo must exist and be public — a 404 here means private or missing.
    const meta = await ghJson<{ default_branch?: string }>(`/repos/${owner}/${repo}`);
    if (!meta) return err("not_found");

    const [readmePayload, topLevel, pkgPayload, envPayload] = await Promise.all([
      ghJson<{ content?: string; encoding?: string }>(`/repos/${owner}/${repo}/readme`),
      ghJson<Array<{ name: string; type: string }>>(`/repos/${owner}/${repo}/contents`),
      ghJson<{ content?: string; encoding?: string }>(
        `/repos/${owner}/${repo}/contents/package.json`,
      ),
      ghJson<{ content?: string; encoding?: string }>(
        `/repos/${owner}/${repo}/contents/.env.example`,
      ),
    ]);

    const readme = decodeContent(readmePayload);
    const envExample = decodeContent(envPayload);

    let packageJson: Record<string, unknown> | null = null;
    const pkgText = decodeContent(pkgPayload);
    if (pkgText) {
      try {
        packageJson = JSON.parse(pkgText) as Record<string, unknown>;
      } catch {
        packageJson = null;
      }
    }

    const topLevelDirs = Array.isArray(topLevel)
      ? topLevel.filter((e) => e.type === "dir").map((e) => e.name)
      : [];

    // One or two main docs files if a /docs dir exists.
    let docsExcerpt: string | null = null;
    if (topLevelDirs.includes("docs")) {
      const docsList = await ghJson<Array<{ name: string; type: string }>>(
        `/repos/${owner}/${repo}/contents/docs`,
      );
      const files = (docsList ?? [])
        .filter((e) => e.type === "file" && /\.(md|mdx|txt)$/i.test(e.name))
        .slice(0, 2);
      const texts: string[] = [];
      for (const f of files) {
        const payload = await ghJson<{ content?: string; encoding?: string }>(
          `/repos/${owner}/${repo}/contents/docs/${f.name}`,
        );
        const text = decodeContent(payload);
        if (text) texts.push(text);
      }
      docsExcerpt = texts.join("\n\n") || null;
    }

    return ok({ readme, packageJson, topLevelDirs, envExample, docsExcerpt });
  } catch {
    return err("fetch_failed");
  }
}
