import { SITE_URL, type PostMeta } from "@/lib/blog";

// BlogPosting structured data for an article. Same one-script pattern as the
// comparison pages (components/landing/compare/structured-data.tsx).
export function ArticleJsonLd({ post }: { post: PostMeta }) {
  const url = `${SITE_URL}/blog/${post.slug}`;
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{
        __html: JSON.stringify({
          "@context": "https://schema.org",
          "@type": "BlogPosting",
          headline: post.title,
          description: post.description,
          datePublished: post.date,
          dateModified: post.date,
          author: { "@type": "Person", name: post.author ?? "Mathys" },
          publisher: {
            "@type": "Organization",
            name: "Outrival",
            url: SITE_URL,
          },
          mainEntityOfPage: { "@type": "WebPage", "@id": url },
          url,
          image: `${url}/opengraph-image`,
          keywords: post.tags.join(", "),
        }),
      }}
    />
  );
}
