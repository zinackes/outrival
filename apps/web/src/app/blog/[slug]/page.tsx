import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { getAllPostSlugs, getPost, formatPostDate } from "@/lib/blog";
import { BlogShell } from "@/components/blog/blog-shell";
import { renderMdx } from "@/components/blog/mdx";
import { PostCta } from "@/components/blog/post-cta";
import { ArticleJsonLd } from "@/components/blog/article-json-ld";
import { BreadcrumbJsonLd } from "@/components/landing/compare/structured-data";

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
    title: { absolute: `${post.title} — Outrival Blog` },
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
      <BreadcrumbJsonLd
        items={[
          { name: "Home", path: "/" },
          { name: "Blog", path: "/blog" },
          { name: post.title, path: `/blog/${slug}` },
        ]}
      />

      <article className="mx-auto w-full max-w-2xl px-6 py-14 sm:py-20">
        <Link
          href="/blog"
          className="inline-flex items-center gap-1.5 text-sm text-text-muted transition-colors hover:text-foreground"
        >
          <ArrowLeft size={14} /> All posts
        </Link>

        <header className="mt-8 flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-2.5 text-meta text-text-subtle">
            <time dateTime={post.date}>{formatPostDate(post.date)}</time>
            <span aria-hidden>·</span>
            <span>{post.readingTime} min read</span>
            {post.tags.map((tag) => (
              <span key={tag} aria-hidden>
                · {tag}
              </span>
            ))}
          </div>
          <h1 className="text-3xl font-semibold leading-tight tracking-tight sm:text-4xl">
            {post.title}
          </h1>
          <p className="text-lg leading-relaxed text-text-muted">
            {post.description}
          </p>
        </header>

        <div className="prose-blog mt-10">{await renderMdx(post.content)}</div>

        <PostCta />
      </article>
    </BlogShell>
  );
}
