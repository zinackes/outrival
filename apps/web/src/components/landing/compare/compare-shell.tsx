import type { ReactNode } from "react";
import { Nav } from "../nav";
import { Footer } from "../footer";
import { VantaFog, type FogTone } from "../vanta-fog";
import { BreadcrumbJsonLd, SoftwareAppJsonLd } from "./structured-data";

// Brand shell for every page around the landing — /pricing, /vs/*,
// /alternatives/*. It used to be a static sticky bar over a flat background,
// which read as a documentation site parked next to the marketing site. It now
// runs the landing's own composition: paper canvas pinned light (.lp-light, so
// html.dark can't half-theme it), the landing bar that detaches into a floating
// pill on scroll, alternating paper / graphite bands supplied by <Band>, and
// the footer in the dark region the landing ends on.
export function CompareShell({ children }: { children: ReactNode }) {
  return (
    <div className="landing-canvas lp-light lp-page min-h-dvh font-sans antialiased">
      <SoftwareAppJsonLd />
      {/* No <Nav> here: it belongs inside <PageHero>, in flow, so the fog runs
          behind it exactly as it does on the landing. */}
      <main id="main-content" tabIndex={-1}>
        {children}
      </main>
      <div className="dark" data-lp-tone="dark">
        <Footer />
      </div>
    </div>
  );
}

// One band of the page. `dark` flips the whole system token set for the
// subtree (severities, categories, text tiers) exactly like the landing's dark
// body, and marks the box for the nav pill, which samples these regions at its
// own height to decide its tone (see landing/nav.tsx).
export function Band({
  tone = "paper",
  wide = false,
  id,
  children,
}: {
  tone?: "paper" | "dark";
  wide?: boolean;
  id?: string;
  children: ReactNode;
}) {
  const dark = tone === "dark";
  return (
    <section
      id={id}
      className={dark ? "lp-band-dark dark" : "lp-band-paper"}
      data-lp-tone={dark ? "dark" : undefined}
    >
      <div className={wide ? "lp-inner lp-inner-wide" : "lp-inner"}>
        {children}
      </div>
    </section>
  );
}

// The opening of a marketing page, on the landing's own hero: the fog stack
// behind, the bar in flow over it, and a full viewport of it before the first
// cut to graphite. Sans headline with a serif italic accent — the landing's
// register, not the serif-everything the base h1 rule gives an unstyled page.
//
// `crumbs` is structured data only. The visible trail ("Home / Outrival vs
// Crayon") was the one element that still looked like a documentation site
// sitting above the headline; Google reads the JSON-LD either way.
export function PageHero({
  crumbs,
  compact = false,
  fog = "default",
  children,
}: {
  crumbs?: { name: string; path: string }[];
  /** Half-height opening for pages whose subject is the text right below. */
  compact?: boolean;
  /**
   * Which brand hue leads the fog. Same palette everywhere, different ranking,
   * so a page family is recognisable without reading as a separate site.
   */
  fog?: FogTone;
  children: ReactNode;
}) {
  return (
    <section
      className={compact ? "lp-page-hero is-compact" : "lp-page-hero"}
      data-fog={fog}
    >
      {crumbs && <BreadcrumbJsonLd items={crumbs} />}
      <div className="lp-glow-red" aria-hidden />
      <VantaFog tone={fog} />
      <div className="lp-fog-grain" aria-hidden />
      <Nav tone="marketing" />
      <header className="lp-page-head">{children}</header>
    </section>
  );
}
