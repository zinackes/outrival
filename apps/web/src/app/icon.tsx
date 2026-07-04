import { ImageResponse } from "next/og";

// Branded favicon, generated at request time (no binary asset to maintain).
// Next.js icon file convention → injects <link rel="icon">. Indigo brand mark
// matching the OG card logo, with an "O" monogram legible at 16–32px in browser
// tabs and search results.
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
          background: "#6366f1",
          borderRadius: 7,
          color: "#fafafa",
          fontSize: 23,
          fontWeight: 700,
        }}
      >
        O
      </div>
    ),
    { ...size },
  );
}
