import { ImageResponse } from "next/og";

// Apple touch icon (iOS home screen). The orbit mark on the graphite surface,
// sized 180×180 (iOS rounds the corners itself). Kept opaque on purpose: iOS
// renders transparent home-screen icons on black, so the touch icon carries a
// background even though the browser favicon (app/icon.png) is transparent.
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
        <div style={{ position: "relative", display: "flex", width: 118, height: 118 }}>
          <div
            style={{
              width: 118,
              height: 118,
              borderRadius: 59,
              border: "15px solid #f4f4f5",
            }}
          />
          <div
            style={{
              position: "absolute",
              top: 6,
              right: 0,
              width: 42,
              height: 42,
              borderRadius: 21,
              background: "#6d5cff",
              boxShadow: "0 0 18px 4px rgba(109,92,255,0.8)",
            }}
          />
        </div>
      </div>
    ),
    { ...size },
  );
}
