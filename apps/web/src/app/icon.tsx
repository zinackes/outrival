import { ImageResponse } from "next/og";

// Branded favicon, generated at request time (no binary asset to maintain).
// Next.js icon file convention → injects <link rel="icon">. The Outrival orbit
// mark — a white ring with an indigo dot at 1 o'clock — reduced to primitives so
// it stays legible at 16–32px in browser tabs and search results.
export const size = { width: 32, height: 32 };
export const contentType = "image/png";

export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#0b0b0d",
          borderRadius: 7,
        }}
      >
        <div style={{ position: "relative", display: "flex", width: 22, height: 22 }}>
          <div
            style={{
              width: 22,
              height: 22,
              borderRadius: 11,
              border: "3px solid #f4f4f5",
            }}
          />
          <div
            style={{
              position: "absolute",
              top: 1,
              right: 0,
              width: 8,
              height: 8,
              borderRadius: 4,
              background: "#6d5cff",
              boxShadow: "0 0 3px 1px rgba(109,92,255,0.85)",
            }}
          />
        </div>
      </div>
    ),
    { ...size },
  );
}
