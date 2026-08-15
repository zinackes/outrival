import type { ReactNode } from "react";
import Link from "next/link";
import { Nav } from "../nav";
import { Footer } from "../footer";
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
      <Nav tone="marketing" />
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

// The opening of a marketing page: where you are, what the page claims, the
// one-paragraph version, then the actions. Sans headline with a serif italic
// accent — the landing's register, not the serif-everything the base h1 rule
// gives an unstyled page.
export function PageHead({
  crumbs,
  title,
  lead,
  children,
}: {
  crumbs: { name: string; path: string }[];
  title: ReactNode;
  lead?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <header className="lp-page-head">
      <Breadcrumbs items={crumbs} />
      <h1>{title}</h1>
      {lead && <p className="lp-page-lead">{lead}</p>}
      {children && <div className="lp-page-ctas">{children}</div>}
    </header>
  );
}

// Visual breadcrumb + its BreadcrumbList JSON-LD in one place, so the two never
// drift. The last item is the current page (not a link).
export function Breadcrumbs({
  items,
}: {
  items: { name: string; path: string }[];
}) {
  return (
    <nav aria-label="Breadcrumb">
      <BreadcrumbJsonLd items={items} />
      <ol className="lp-crumbs">
        {items.map((it, i) => {
          const last = i === items.length - 1;
          return (
            <li key={it.path}>
              {last ? (
                <span aria-current="page">{it.name}</span>
              ) : (
                <>
                  <Link href={it.path}>{it.name}</Link>
                  <span aria-hidden>/</span>
                </>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
