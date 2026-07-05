import { ImageResponse } from "next/og";
import { getAllPostSlugs, getPost } from "@/lib/blog";

// Auto OG card per article: dark brand canvas, Iris wordmark, the tag as an
// eyebrow, the title set large. Uses the built-in ImageResponse font (no network
// fetch at build) so generation can't fail on a missing asset. Rendered once per
// slug at build via generateStaticParams.
export const alt = "Outrival Blog";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export function generateStaticParams() {
  return getAllPostSlugs().map((slug) => ({ slug }));
}

export default async function Image({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const post = getPost(slug);
  const title = post?.title ?? "Outrival Blog";
  const eyebrow = (post?.tags?.[0] ?? "Blog").toUpperCase();

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          background: "#0a0a0a",
          padding: "72px 80px",
          color: "#f2f5f8",
        }}
      >
        <div style={{ display: "flex", fontSize: 30, fontWeight: 600, letterSpacing: -0.5 }}>
          <span>Out</span>
          <span style={{ color: "#8b7dff" }}>rival</span>
        </div>

        <div style={{ display: "flex", flexDirection: "column" }}>
          <div
            style={{
              display: "flex",
              fontSize: 22,
              letterSpacing: 3,
              color: "#8b7dff",
              marginBottom: 24,
            }}
          >
            {eyebrow}
          </div>
          <div
            style={{
              display: "flex",
              fontSize: title.length > 52 ? 58 : 68,
              fontWeight: 700,
              lineHeight: 1.08,
              letterSpacing: -1.5,
              maxWidth: 1000,
            }}
          >
            {title}
          </div>
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            fontSize: 24,
            color: "#9aa2ad",
          }}
        >
          <div style={{ display: "flex", width: 10, height: 10, borderRadius: 9999, background: "#8b7dff" }} />
          outrival.app/blog
        </div>
      </div>
    ),
    { ...size },
  );
}
