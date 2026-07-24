import type { Metadata } from "next";
import { pageMetadata } from "@/lib/metadata";
import Link from "next/link";
import { Rss } from "lucide-react";
import { getAllPosts, formatPostDate } from "@/lib/blog";
import { BlogShell } from "@/components/blog/blog-shell";

const DESCRIPTION =
  "Field notes on competitive intelligence: how competitors move, what the tools really cost, and how Outrival is built. Quality over volume, roughly one a month.";

export const metadata: Metadata = pageMetadata({
  path: "/blog",
  title: "Blog",
  description: DESCRIPTION,
  socialTitle: "Outrival Blog",
  alternateTypes: { "application/rss+xml": "/blog/rss.xml" },
});

export default function BlogIndexPage() {
  const posts = getAllPosts();

  return (
    <BlogShell>
      <section className="mx-auto w-full max-w-2xl px-6 py-14 sm:py-20">
        <header className="flex flex-col gap-4">
          <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
            Blog
          </h1>
          <p className="text-lg leading-relaxed text-text-muted">{DESCRIPTION}</p>
          <a
            href="/blog/rss.xml"
            className="inline-flex w-fit items-center gap-1.5 text-sm text-text-muted transition-colors hover:text-foreground"
          >
            <Rss size={14} /> RSS feed
          </a>
        </header>

        <ul className="mt-12 flex flex-col divide-y divide-border border-t border-border">
          {posts.map((post) => (
            <li key={post.slug}>
              <Link
                href={`/blog/${post.slug}`}
                className="group flex flex-col gap-2 py-7 transition-colors"
              >
                <div className="flex items-center gap-2.5 text-meta text-text-subtle">
                  <time dateTime={post.date}>{formatPostDate(post.date)}</time>
                  <span aria-hidden>·</span>
                  <span>{post.readingTime} min read</span>
                </div>
                <h2 className="text-xl font-semibold tracking-tight text-foreground transition-colors group-hover:text-primary">
                  {post.title}
                </h2>
                <p className="leading-relaxed text-text-muted">
                  {post.description}
                </p>
                {post.tags.length > 0 && (
                  <div className="mt-1 flex flex-wrap gap-2">
                    {post.tags.map((tag) => (
                      <span
                        key={tag}
                        className="rounded-sm border border-border bg-surface-2 px-2 py-0.5 text-meta text-text-muted"
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                )}
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </BlogShell>
  );
}
