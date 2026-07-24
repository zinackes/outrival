import { test, expect, describe } from "bun:test";
import { getAllPostSlugs, getAllPosts, getPost } from "../src/lib/blog";

// The blog is prerendered from local .mdx at build time, so a malformed
// frontmatter block is not a broken page — it fails `next build` and takes the
// whole deploy down (an unquoted `: ` inside a value did exactly that). These
// run in CI so bad frontmatter is caught before it reaches Coolify.

describe("blog content", () => {
  test("every post parses", () => {
    const slugs = getAllPostSlugs();
    expect(slugs.length).toBeGreaterThan(0);
    for (const slug of slugs) {
      expect(getPost(slug), `post "${slug}" failed to parse`).not.toBeNull();
    }
  });

  test("every post carries the frontmatter the listing and RSS need", () => {
    for (const post of getAllPosts()) {
      expect(post.title.length, post.slug).toBeGreaterThan(0);
      expect(post.description.length, post.slug).toBeGreaterThan(0);
      expect(post.date, post.slug).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(Array.isArray(post.tags), post.slug).toBe(true);
    }
  });
});
