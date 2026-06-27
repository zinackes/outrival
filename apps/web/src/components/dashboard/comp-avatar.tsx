"use client";

import { useState } from "react";
import { useTheme } from "next-themes";

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

// A favicon's shape (how much of the square it fills) and its glyph luminance are
// intrinsic to the image, not the theme — measure once per domain and cache. The render
// *mode* is derived from this plus the active surface, so it stays theme-aware.
type Measure = { coverage: number; lum: number };
const measureCache = new Map<string, Measure>();

// Read the proxied favicon's pixels (same-origin → canvas is not tainted). `coverage` is
// the fraction of meaningfully-opaque pixels (an opaque branded square ≈ 1, a bare glyph
// ≪ 1). `lum` is the alpha-weighted luminance of the opaque pixels — the glyph's own
// tone — from 0 (black) to 1 (white).
function measureFavicon(img: HTMLImageElement): Measure {
  const S = 32;
  const canvas = document.createElement("canvas");
  canvas.width = S;
  canvas.height = S;
  const ctx = canvas.getContext("2d");
  if (!ctx) return { coverage: 0, lum: 1 };
  ctx.drawImage(img, 0, 0, S, S);
  const { data } = ctx.getImageData(0, 0, S, S);
  let lumSum = 0;
  let alphaSum = 0;
  let opaque = 0;
  for (let i = 0; i < data.length; i += 4) {
    const a = data[i + 3] ?? 0;
    if (a >= 128) opaque++;
    if (a === 0) continue;
    const r = data[i] ?? 0;
    const g = data[i + 1] ?? 0;
    const b = data[i + 2] ?? 0;
    lumSum += ((0.2126 * r + 0.7152 * g + 0.0722 * b) / 255) * a;
    alphaSum += a;
  }
  return {
    coverage: opaque / (S * S),
    lum: alphaSum === 0 ? 1 : lumSum / alphaSum,
  };
}

type Mode =
  | { kind: "fill" } // opaque branded square → full-bleed, carries its own background
  | { kind: "bare" } // transparent glyph that already contrasts → no plate
  | { kind: "halo"; color: string }; // glyph too close to the surface → 1px outline

// Tier the treatment. An opaque favicon fills the tile (it brings its own background). A
// transparent glyph sits bare on the tile unless its luminance is too close to the
// current surface to read — then it gets a thin outline in the opposite direction (a dark
// outline for a pale glyph on the light surface, a light outline for a dark glyph on the
// dark surface). Never a filled chip: that opposite-tone square is what we're avoiding.
function deriveMode(m: Measure, isDark: boolean): Mode {
  if (m.coverage >= 0.85) return { kind: "fill" };
  if (isDark) {
    if (m.lum <= 0.4) return { kind: "halo", color: "var(--logo-halo-light)" };
  } else if (m.lum >= 0.6) {
    return { kind: "halo", color: "var(--logo-halo-dark)" };
  }
  return { kind: "bare" };
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
  const { resolvedTheme } = useTheme();
  const [failed, setFailed] = useState(false);
  const [measure, setMeasure] = useState<Measure | null>(() =>
    domain ? (measureCache.get(domain) ?? null) : null,
  );
  const showIcon = domain !== null && !failed;

  // Prefer next-themes (re-renders on toggle); fall back to the html class for the first
  // client paint before the hook resolves, so a dark-mode tile doesn't flash. The
  // theme-dependent branch only matters once `measure` is set (post-hydration), so this
  // never causes a hydration mismatch.
  const isDark =
    (resolvedTheme ??
      (typeof document !== "undefined" &&
      document.documentElement.classList.contains("dark")
        ? "dark"
        : "light")) === "dark";

  const mode = measure ? deriveMode(measure, isDark) : null;
  const pad = mode?.kind === "fill" ? 0 : Math.max(2, Math.round(size * 0.15));

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
      {/* The initial sits underneath; once the favicon loads it covers the letter. A
          missing URL or a load error leaves the letter visible — never an empty box. */}
      {letter}
      {showIcon && (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element -- dynamic proxied icon, not a static asset */}
          <img
            src={`/api/favicon?domain=${encodeURIComponent(domain)}`}
            alt=""
            aria-hidden
            loading="lazy"
            onLoad={(e) => {
              if (measureCache.has(domain)) return;
              try {
                const m = measureFavicon(e.currentTarget);
                measureCache.set(domain, m);
                setMeasure(m);
              } catch {
                // Cross-origin/decoding edge — keep the bare treatment.
              }
            }}
            onError={() => setFailed(true)}
            style={{
              position: "absolute",
              inset: 0,
              width: "100%",
              height: "100%",
              objectFit: "contain",
              padding: pad,
              filter:
                mode?.kind === "halo"
                  ? `drop-shadow(0 0 1px ${mode.color}) drop-shadow(0 0 1px ${mode.color})`
                  : undefined,
            }}
          />
          {/* Hairline tile edge — above the icon so it reads on an opaque full-bleed
              favicon too, and kept off the <img> so the halo filter outlines only the
              glyph, not the tile's own border. */}
          <div
            aria-hidden
            style={{
              position: "absolute",
              inset: 0,
              borderRadius: 4,
              boxShadow: "inset 0 0 0 1px var(--border)",
              pointerEvents: "none",
            }}
          />
        </>
      )}
    </div>
  );
}
