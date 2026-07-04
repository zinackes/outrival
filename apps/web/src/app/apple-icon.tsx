import { ImageResponse } from "next/og";

// Apple touch icon (iOS home screen). Same brand mark as app/icon.tsx on the
// graphite surface, sized 180×180 (iOS rounds the corners itself).
export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "linear-gradient(135deg, #0b0b0d 0%, #16161a 100%)",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: 132,
            height: 132,
            borderRadius: 30,
            background: "#6366f1",
            color: "#fafafa",
            fontSize: 78,
            fontWeight: 700,
          }}
        >
          O
        </div>
      </div>
    ),
    { ...size },
  );
}
