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

// Tile tone is a function of the favicon, not the theme, so a domain's tone is
// stable across every avatar on the page (and across renders). Cache it once.
type Tone = "light" | "dark";
const toneCache = new Map<string, Tone>();

// Read the proxied favicon's pixels (same-origin → canvas is not tainted) and pick
// the chip that contrasts with it. Luminance is alpha-weighted: for a transparent
// favicon only the opaque glyph counts; for an opaque one it's the whole square's
// average. Light content → dark chip, dark content → light chip ("least worst" for
// the rare opaque-but-low-contrast favicons — we still show the logo, never a blank).
function measureTone(img: HTMLImageElement): Tone {
  const S = 32;
  const canvas = document.createElement("canvas");
  canvas.width = S;
  canvas.height = S;
  const ctx = canvas.getContext("2d");
  if (!ctx) return "light";
  ctx.drawImage(img, 0, 0, S, S);
  const { data } = ctx.getImageData(0, 0, S, S);
  let lumSum = 0;
  let alphaSum = 0;
  for (let i = 0; i < data.length; i += 4) {
    const a = data[i + 3] ?? 0;
    if (a === 0) continue;
    const r = data[i] ?? 0;
    const g = data[i + 1] ?? 0;
    const b = data[i + 2] ?? 0;
    const lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
    lumSum += lum * a;
    alphaSum += a;
  }
  if (alphaSum === 0) return "light";
  // Bias toward the light chip (current behaviour) — only flip to the dark chip for
  // genuinely light favicons, so mid-tone coloured logos keep the lighter tile.
  return lumSum / alphaSum >= 0.55 ? "dark" : "light";
}

export function CompAvatar({
  name,
  url,
  size = 32,
}: {
  name: string;
  url?: string | null;
  size?: number;
}) {
  const letter = name ? name[0]!.toUpperCase() : "?";
  const domain = domainFromUrl(url);
  const [failed, setFailed] = useState(false);
  const [tone, setTone] = useState<Tone>(() =>
    domain ? (toneCache.get(domain) ?? "light") : "light",
  );
  const showIcon = domain !== null && !failed;

  return (
    <div
      style={{
        position: "relative",
        width: size,
        height: size,
        borderRadius: 4,
        background: "var(--surface-2)",
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
      {/* The initial sits underneath; once the favicon loads it covers the letter.
          The icon renders on an adaptive chip (light or dark, chosen from the
          favicon's own luminance) so it stays legible whatever its colour. Missing
          URL or a load error leaves the letter visible — the avatar never renders
          empty. */}
      {letter}
      {showIcon && (
        // eslint-disable-next-line @next/next/no-img-element -- dynamic proxied icon, not a static asset
        <img
          src={`/api/favicon?domain=${encodeURIComponent(domain)}`}
          alt=""
          aria-hidden
          loading="lazy"
          onLoad={(e) => {
            if (toneCache.has(domain)) return;
            try {
              const t = measureTone(e.currentTarget);
              toneCache.set(domain, t);
              setTone(t);
            } catch {
              // Cross-origin/decoding edge — keep the default light chip.
            }
          }}
          onError={() => setFailed(true)}
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            objectFit: "contain",
            padding: Math.max(2, Math.round(size * 0.15)),
            background:
              tone === "dark" ? "var(--logo-chip-dark)" : "var(--logo-chip)",
            // Hairline edge so the chip reads as a tile against the card without a
            // hard same-colour seam (white-on-white in light, the dark chip in dark).
            boxShadow: "inset 0 0 0 1px var(--border)",
            borderRadius: 4,
          }}
        />
      )}
    </div>
  );
}
