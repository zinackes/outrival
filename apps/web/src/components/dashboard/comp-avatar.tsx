"use client";

import { useState } from "react";

function domainFromUrl(url?: string | null): string | null {
  if (!url) return null;
  try {
    return new URL(url.includes("://") ? url : `https://${url}`).hostname.replace(
      /^www\./,
      "",
    );
  } catch {
    return null;
  }
}

export function CompAvatar({
  name,
  url,
  size = 28,
}: {
  name: string;
  url?: string | null;
  size?: number;
}) {
  const letter = name ? name[0]!.toUpperCase() : "?";
  const domain = domainFromUrl(url);
  const [failed, setFailed] = useState(false);
  const showIcon = domain !== null && !failed;

  return (
    <div
      style={{
        position: "relative",
        width: size,
        height: size,
        borderRadius: 4,
        background: "var(--surface-2)",
        border: "1px solid var(--border)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontFamily: "var(--font-display)",
        fontWeight: 600,
        fontSize: Math.round(size * 0.46),
        flexShrink: 0,
        overflow: "hidden",
      }}
    >
      {/* The initial sits underneath; once the favicon loads it covers the letter
          (the icon carries its own opaque background). Missing URL or a load error
          leaves the letter visible — the avatar never renders empty. */}
      {letter}
      {showIcon && (
        // eslint-disable-next-line @next/next/no-img-element -- dynamic proxied icon, not a static asset
        <img
          src={`/api/favicon?domain=${encodeURIComponent(domain)}`}
          alt=""
          aria-hidden
          loading="lazy"
          onError={() => setFailed(true)}
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            objectFit: "contain",
            padding: Math.max(2, Math.round(size * 0.15)),
            background: "var(--surface-2)",
            borderRadius: 4,
          }}
        />
      )}
    </div>
  );
}
