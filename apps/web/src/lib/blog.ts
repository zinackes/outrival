import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import matter from "gray-matter";

// Local-file MDX blog. Posts live as `.mdx` files in `apps/web/content/blog`
// (process.cwd() is the app root at build time). Frontmatter is parsed here for
// the listing / metadata / RSS; the raw body is compiled per-post by the article
// page (see components/blog/mdx.tsx). No CMS, no bundler magic — just fs reads at
// build, so every post prerenders to static HTML with zero client JS.

export const SITE_URL = "https://outrival.app";

const BLOG_DIR = join(process.cwd(), "content/blog");
const WORDS_PER_MINUTE = 200;

export type PostFrontmatter = {
  title: string;
  description: string;
  date: string; // ISO date, YYYY-MM-DD
  tags: string[];
  author?: string;
};

export type PostMeta = PostFrontmatter & {
  slug: string;
  readingTime: number; // whole minutes
};

export type Post = PostMeta & { content: string };

function readingMinutes(body: string): number {
  const words = body.trim().split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round(words / WORDS_PER_MINUTE));
}

// gray-matter's YAML errors name neither the file nor the fix, and a throw here
// kills the whole prerender — so re-throw with the slug and the usual culprit.
function readFrontmatter(slug: string, raw: string) {
  try {
    return matter(raw);
  } catch (err) {
    throw new Error(
      `Blog post "${slug}" has invalid frontmatter YAML — an unquoted ": " inside a value is the usual cause. ${(err as Error).message}`,
    );
  }
}

function parseFile(slug: string): Post {
  const raw = readFileSync(join(BLOG_DIR, `${slug}.mdx`), "utf8");
  const { data, content } = readFrontmatter(slug, raw);
  const fm = data as Partial<PostFrontmatter>;
  if (!fm.title || !fm.description || !fm.date) {
    throw new Error(
      `Blog post "${slug}" is missing required frontmatter (title, description, date).`,
    );
  }
  return {
    slug,
    title: fm.title,
    description: fm.description,
    date: fm.date,
    tags: Array.isArray(fm.tags) ? fm.tags : [],
    author: fm.author,
    readingTime: readingMinutes(content),
    content,
  };
}

export function getAllPostSlugs(): string[] {
  return readdirSync(BLOG_DIR)
    .filter((f) => f.endsWith(".mdx"))
    .map((f) => f.replace(/\.mdx$/, ""));
}

// Listing / RSS / sitemap — metadata only, newest first.
export function getAllPosts(): PostMeta[] {
  return getAllPostSlugs()
    .map((slug) => {
      const { content: _content, ...meta } = parseFile(slug);
      return meta;
    })
    .sort((a, b) => (a.date < b.date ? 1 : -1));
}

export function getPost(slug: string): Post | null {
  try {
    return parseFile(slug);
  } catch {
    return null;
  }
}

// Deterministic, UTC-pinned so the build server's timezone never shifts a date
// by a day (dates are authored as bare YYYY-MM-DD). English per the language rule.
export function formatPostDate(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
}
