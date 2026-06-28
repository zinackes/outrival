"use client";

import { useState } from "react";
import { useTheme } from "next-themes";
import {
  competitorColorVars,
  COMP_ACCENT,
  COMP_FILL,
  COMP_ON_FILL,
} from "@/lib/competitor-color";

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
//    into the current surface. `src` is the trimmed, recentred glyph rendered in place of
//    the raw favicon (null only when the tile is blank).
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

// When de-plating, fade pixels by their distance from white rather than hard-cutting at a
// threshold — a binary key leaves jagged edges on low-quality (JPEG) favicons. Pure white →
// fully transparent, clearly coloured/dark → kept, with a feathered ramp between. Anything
// left fainter than ALPHA_FLOOR is snapped to zero so the feather doesn't leave a pale grey
// ghost ("résidu") of the plate around the glyph.
const PLATE_FEATHER_LO = 50; // distance-from-white below which a pixel is fully plate
const PLATE_FEATHER_HI = 160; // distance-from-white above which a pixel is fully glyph

// The favicon proxies center the real glyph inside a square of incidental — and usually
// lopsided — transparent margin. objectFit:contain centers the whole canvas, margin and all,
// so the glyph renders off-center. We trim to the glyph's tight bounds and recenter it, so
// every icon sits dead-center in its tile. A larger analysis canvas keeps the recentred PNG
// crisp on the bigger avatars.
const ANALYSIS_SIZE = 48;
const BBOX_ALPHA = 24; // min alpha for a pixel to count toward the glyph's visual bounds
const ALPHA_FLOOR = 20; // remaining alpha below this is snapped to 0 (kills faint fringe)

// Tight bounding box of the meaningfully-opaque pixels, or null when the tile is blank.
function glyphBounds(data: Uint8ClampedArray, S: number) {
  let minX = S;
  let minY = S;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      if ((data[(y * S + x) * 4 + 3] ?? 0) >= BBOX_ALPHA) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  return maxX < 0 ? null : { minX, minY, maxX, maxY };
}

// Crop the glyph to its bounds and recenter it in a square (aspect ratio preserved), dropping
// the lopsided margin. Returns a PNG data URL the <img> renders in place of the raw favicon.
function recenteredGlyph(
  canvas: HTMLCanvasElement,
  b: { minX: number; minY: number; maxX: number; maxY: number },
): string {
  const w = b.maxX - b.minX + 1;
  const h = b.maxY - b.minY + 1;
  const side = Math.max(w, h);
  const out = document.createElement("canvas");
  out.width = side;
  out.height = side;
  const octx = out.getContext("2d");
  if (!octx) return canvas.toDataURL("image/png");
  octx.drawImage(
    canvas,
    b.minX,
    b.minY,
    w,
    h,
    Math.round((side - w) / 2),
    Math.round((side - h) / 2),
    w,
    h,
  );
  return out.toDataURL("image/png");
}

function analyzeFavicon(img: HTMLImageElement): Analysis {
  const S = ANALYSIS_SIZE;
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
  const deplate = plateFrac >= 0.45 && glyphFrac > 0.03;

  // An opaque branded square (no plate to key out) carries its own background — show it
  // edge to edge as-is, no trim.
  if (!deplate && coverage >= 0.85) return { kind: "fill" };

  if (deplate) {
    for (let i = 0; i < data.length; i += 4) {
      const a = data[i + 3] ?? 0;
      if (a === 0) continue;
      const dr = 255 - data[i]!;
      const dg = 255 - data[i + 1]!;
      const db = 255 - data[i + 2]!;
      const dist = Math.sqrt(dr * dr + dg * dg + db * db);
      const keep = Math.min(
        1,
        Math.max(0, (dist - PLATE_FEATHER_LO) / (PLATE_FEATHER_HI - PLATE_FEATHER_LO)),
      );
      const next = Math.round(a * keep);
      data[i + 3] = next < ALPHA_FLOOR ? 0 : next;
    }
  } else {
    // Bare transparent glyph: drop only the near-invisible anti-aliasing fringe that would
    // otherwise read as a pale halo on the dark tile.
    for (let i = 0; i < data.length; i += 4) {
      if ((data[i + 3] ?? 0) < ALPHA_FLOOR) data[i + 3] = 0;
    }
  }
  ctx.putImageData(image, 0, 0);

  const bounds = glyphBounds(data, S);
  const lum = deplate
    ? glyphAlpha
      ? glyphLumSum / glyphAlpha
      : 1
    : allAlpha
      ? allLumSum / allAlpha
      : 1;
  return {
    kind: "glyph",
    lum,
    src: bounds ? recenteredGlyph(canvas, bounds) : null,
  };
}

export function CompAvatar({
  name,
  url,
  color,
  size = 32,
}: {
  name: string;
  url?: string | null;
  // User-assigned color (palette token or "#rrggbb"). Null/absent → neutral tile.
  color?: string | null;
  size?: number;
}) {
  const letter = name ? name[0]!.toUpperCase() : "?";
  const domain = domainFromUrl(url);
  const colorVars = competitorColorVars(color);
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
        ...colorVars,
        position: "relative",
        width: size,
        height: size,
        borderRadius: 4,
        // Tinted tile + letter when the user assigned a color (a favicon, once
        // loaded, covers the fill); neutral surface otherwise.
        background: colorVars ? COMP_FILL : "var(--surface-2)",
        color: colorVars ? COMP_ON_FILL : undefined,
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
              // Analyse a domain once, then reuse it for every avatar of that domain. When a
              // sibling already cached the result (or this <img> re-fired onLoad after `src`
              // swapped to the recentred data URL), adopt the cached analysis instead of
              // re-running it — without this, the avatar that loses the race keeps
              // `analysis` null and renders the raw, off-center favicon.
              const cached = cache.get(domain);
              if (cached) {
                setAnalysis(cached);
                return;
              }
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
              // Colored ring carries the identity on a favicon tile; neutral hairline otherwise.
              boxShadow: `inset 0 0 0 1px ${colorVars ? COMP_ACCENT : "var(--border)"}`,
              pointerEvents: "none",
            }}
          />
        </>
      )}
    </div>
  );
}
