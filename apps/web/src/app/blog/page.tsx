import type { Metadata } from "next";
import { pageMetadata } from "@/lib/metadata";
import Link from "next/link";
import { getAllPosts, formatPostDate } from "@/lib/blog";
import { BlogShell } from "@/components/blog/blog-shell";
import { Band, PageHero } from "@/components/landing/compare/compare-shell";

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
      <PageHero
        fog="editorial"
        crumbs={[
          { name: "Home", path: "/" },
          { name: "Blog", path: "/blog" },
        ]}
      >
        <h1>
          Field notes on competitive{" "}
          <span className="lp-serif-accent">intelligence</span>
        </h1>
        <p className="lp-page-lead">{DESCRIPTION}</p>
        <div className="lp-page-ctas">
          <a className="lp-link-sample" href="/blog/rss.xml">
            RSS feed
          </a>
        </div>
      </PageHero>

      <Band tone="paper">
        <ul className="lp-posts">
          {posts.map((post) => (
            <li key={post.slug}>
              <Link href={`/blog/${post.slug}`}>
                <div className="lp-post-meta">
                  <time dateTime={post.date}>{formatPostDate(post.date)}</time>
                </div>
                <div>
                  <h2>{post.title}</h2>
                  <p>{post.description}</p>
                  <div className="lp-post-tags">
                    <span>{post.readingTime} min read</span>
                    {post.tags.map((tag) => (
                      <span key={tag}>{tag}</span>
                    ))}
                  </div>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      </Band>
    </BlogShell>
  );
}
