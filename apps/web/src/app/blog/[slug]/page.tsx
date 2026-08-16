import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeftIcon } from "@/components/icons";
import { getAllPostSlugs, getPost, formatPostDate } from "@/lib/blog";
import { BlogShell } from "@/components/blog/blog-shell";
import { renderMdx } from "@/components/blog/mdx";
import { PostCta } from "@/components/blog/post-cta";
import { ArticleJsonLd } from "@/components/blog/article-json-ld";
import { PageHero } from "@/components/landing/compare/compare-shell";

// Only the authored posts exist — unknown slugs 404 instead of rendering on demand.
export const dynamicParams = false;

export function generateStaticParams() {
  return getAllPostSlugs().map((slug) => ({ slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const post = getPost(slug);
  if (!post) return {};
  const url = `/blog/${slug}`;
  return {
    title: { absolute: `${post.title} | Outrival Blog` },
    description: post.description,
    alternates: { canonical: url },
    openGraph: {
      type: "article",
      url,
      title: post.title,
      description: post.description,
      publishedTime: post.date,
      tags: post.tags,
      // og:image comes from the sibling opengraph-image.tsx file convention.
    },
    twitter: {
      card: "summary_large_image",
      title: post.title,
      description: post.description,
    },
  };
}

export default async function BlogPostPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const post = getPost(slug);
  if (!post) notFound();

  return (
    <BlogShell>
      <ArticleJsonLd post={post} />

      {/* compact: the fog opens the article, it does not replace it — a full
          fold in front of a 12-minute read is a toll gate. */}
      <PageHero
        compact
        crumbs={[
          { name: "Home", path: "/" },
          { name: "Blog", path: "/blog" },
          { name: post.title, path: `/blog/${slug}` },
        ]}
      >
        <h1>{post.title}</h1>
        <p className="lp-page-lead">{post.description}</p>
        <div className="lp-post-tags">
          <time dateTime={post.date}>{formatPostDate(post.date)}</time>
          <span>{post.readingTime} min read</span>
          {post.tags.map((tag) => (
            <span key={tag}>{tag}</span>
          ))}
        </div>
      </PageHero>

      <article className="lp-article">
        <div className="prose-blog">{await renderMdx(post.content)}</div>

        <PostCta />

        <div className="lp-xlinks">
          <Link href="/blog">
            <ArrowLeftIcon size={14} aria-hidden /> All posts
          </Link>
        </div>
      </article>
    </BlogShell>
  );
}
