import { ImageResponse } from "next/og";

// Site-wide Open Graph / social share card, generated at request time (no binary
// asset to maintain). Root-level file convention → default og:image for every
// route that doesn't declare its own. Uses the built-in default font; the brand
// Zodiak serif is intentionally not loaded here to keep this dependency-free.
export const alt = "Outrival: Automated competitive intelligence, written by AI";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OgImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "72px 80px",
          background: "linear-gradient(135deg, #0b0b0d 0%, #16161a 100%)",
          color: "#fafafa",
        }}
      >
        <div style={{ display: "flex", alignItems: "center" }}>
          <div
            style={{
              position: "relative",
              display: "flex",
              width: 52,
              height: 52,
              marginRight: 18,
            }}
          >
            <div
              style={{
                width: 52,
                height: 52,
                borderRadius: 26,
                border: "7px solid #fafafa",
              }}
            />
            <div
              style={{
                position: "absolute",
                top: 2,
                right: 0,
                width: 19,
                height: 19,
                borderRadius: 10,
                background: "#6d5cff",
                boxShadow: "0 0 14px 3px rgba(109,92,255,0.85)",
              }}
            />
          </div>
          <div style={{ fontSize: 38, fontWeight: 700, letterSpacing: "-0.02em" }}>
            Outrival
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column" }}>
          <div
            style={{
              fontSize: 66,
              fontWeight: 700,
              lineHeight: 1.05,
              letterSpacing: "-0.03em",
              maxWidth: 940,
              marginBottom: 24,
            }}
          >
            Automated competitive intelligence, written by AI
          </div>
          <div style={{ fontSize: 30, color: "#a1a1aa", maxWidth: 860, lineHeight: 1.3 }}>
            Monitor every competitor move: pricing, product, hiring, reviews. One
            strategic brief a week.
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", fontSize: 24, color: "#71717a" }}>
          <div
            style={{
              width: 8,
              height: 8,
              borderRadius: 4,
              background: "#22c55e",
              marginRight: 12,
            }}
          />
          <div>outrival.app · hosted in the EU</div>
        </div>
      </div>
    ),
    { ...size },
  );
}
