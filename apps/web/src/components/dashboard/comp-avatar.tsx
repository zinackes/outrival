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

// What to draw for a domain, decided once from the favicon's pixels and cached.
//  - "fill": an opaque branded square (solid colour, gradient, photo) — show it edge to
//    edge, it carries its own background.
//  - "glyph": a transparent glyph (or one we de-plated, see below). It sits bare on the
//    tile; `lum` is its luminance so the render can add a halo only when it would vanish
//    into the current surface. `src` overrides the favicon URL when we keyed out a plate.
type Analysis =
  | { kind: "fill" }
  | { kind: "glyph"; lum: number; src: string | null };

const cache = new Map<string, Analysis>();

// The favicon proxies (Google, then DuckDuckGo) bake a solid WHITE square behind
// transparent favicons — often as an opaque JPEG with no alpha at all. Left alone that
// white plate fills the tile and glares on the dark theme. We detect it by AREA (the
// near-white pixels dominate the image) and key them out, so the real glyph reads bare —
// exactly as it does in the browser tab. A coloured/gradient brand tile has few near-white
// pixels and is kept as "fill".
function isPlatePixel(r: number, g: number, b: number, a: number): boolean {
  return a > 240 && Math.min(r, g, b) > 225 && Math.max(r, g, b) - Math.min(r, g, b) < 18;
}

function analyzeFavicon(img: HTMLImageElement): Analysis {
  const S = 32;
  const canvas = document.createElement("canvas");
  canvas.width = S;
  canvas.height = S;
  const ctx = canvas.getContext("2d");
  if (!ctx) return { kind: "glyph", lum: 1, src: null };
  ctx.drawImage(img, 0, 0, S, S);
  const image = ctx.getImageData(0, 0, S, S);
  const { data } = image;

  let opaque = 0;
  let plateCount = 0;
  let allLumSum = 0;
  let allAlpha = 0;
  let glyphLumSum = 0;
  let glyphAlpha = 0;
  for (let i = 0; i < data.length; i += 4) {
    const a = data[i + 3] ?? 0;
    if (a >= 128) opaque++;
    if (a === 0) continue;
    const r = data[i]!;
    const g = data[i + 1]!;
    const b = data[i + 2]!;
    const lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
    allLumSum += lum * a;
    allAlpha += a;
    if (isPlatePixel(r, g, b, a)) {
      plateCount++;
    } else {
      glyphLumSum += lum * a;
      glyphAlpha += a;
    }
  }

  const coverage = opaque / (S * S);
  // The baked white plate dominates the tile by area; the real glyph is the coloured
  // remainder (which can run into a corner, so corner sampling would miss it). Key the
  // plate out only when a real glyph is left — never erase a near-blank white favicon.
  const plateFrac = opaque ? plateCount / opaque : 0;
  const glyphFrac = (opaque - plateCount) / (S * S);

  if (plateFrac >= 0.45 && glyphFrac > 0.03) {
    for (let i = 0; i < data.length; i += 4) {
      const a = data[i + 3] ?? 0;
      if (a !== 0 && isPlatePixel(data[i]!, data[i + 1]!, data[i + 2]!, a)) {
        data[i + 3] = 0;
      }
    }
    ctx.putImageData(image, 0, 0);
    return {
      kind: "glyph",
      lum: glyphAlpha ? glyphLumSum / glyphAlpha : 1,
      src: canvas.toDataURL("image/png"),
    };
  }

  if (coverage >= 0.85) return { kind: "fill" };
  return { kind: "glyph", lum: allAlpha ? allLumSum / allAlpha : 1, src: null };
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
  const [analysis, setAnalysis] = useState<Analysis | null>(() =>
    domain ? (cache.get(domain) ?? null) : null,
  );
  const showIcon = domain !== null && !failed;
  const faviconSrc = domain
    ? `/api/favicon?domain=${encodeURIComponent(domain)}`
    : "";

  // Prefer next-themes (re-renders on toggle); fall back to the html class for the first
  // client paint before the hook resolves, so a dark-mode tile doesn't flash. The
  // theme-dependent branch only matters once `analysis` is set (post-hydration), so this
  // never causes a hydration mismatch.
  const isDark =
    (resolvedTheme ??
      (typeof document !== "undefined" &&
      document.documentElement.classList.contains("dark")
        ? "dark"
        : "light")) === "dark";

  const fill = analysis?.kind === "fill";
  // A glyph vanishes when its luminance sits on the same side as the surface: pale on the
  // light surface, dark on the dark surface. Only then draw a 1px outline (never a square).
  const lum = analysis?.kind === "glyph" ? analysis.lum : null;
  const halo = lum !== null && (isDark ? lum <= 0.4 : lum >= 0.6);
  const haloColor = isDark ? "var(--logo-halo-light)" : "var(--logo-halo-dark)";
  const src =
    analysis?.kind === "glyph" && analysis.src ? analysis.src : faviconSrc;
  const pad = fill ? 0 : Math.max(2, Math.round(size * 0.15));

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
            src={src}
            alt=""
            aria-hidden
            loading="lazy"
            onLoad={(e) => {
              // The keyed-glyph case re-fires onLoad with the data: URL — the cache guard
              // stops a second analysis (and any loop).
              if (cache.has(domain)) return;
              try {
                const a = analyzeFavicon(e.currentTarget);
                cache.set(domain, a);
                setAnalysis(a);
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
              filter: halo
                ? `drop-shadow(0 0 1px ${haloColor}) drop-shadow(0 0 1px ${haloColor})`
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
