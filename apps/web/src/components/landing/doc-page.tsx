import type { ReactNode } from "react";
import { Footer } from "./footer";
import { PageHero } from "./compare/compare-shell";

// Shared shell for the standalone marketing/legal pages (about, bot, docs,
// status, changelog, security, terms, privacy, dpa). It ran its own minimal
// header — wordmark plus a back link — which read as a different site from the
// one the reader had just left. It now runs the landing's composition: paper
// canvas pinned light (.lp-light), the bar that detaches into a floating pill
// on scroll, and the footer in the dark region the landing ends on.
//
// The back link went with the old header: the nav's wordmark already goes home,
// and the nav carries the rest of the site with it.
export function DocPage({
  title,
  updated,
  intro,
  children,
}: {
  // ReactNode, not string: the landing's headline signature is one serif-italic
  // word inside an otherwise sans display line, and a page can only place that
  // span itself.
  title: ReactNode;
  updated?: string;
  intro?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="landing-canvas lp-light lp-page min-h-dvh font-sans antialiased">
      <main id="main-content" tabIndex={-1}>
        {/* compact: same fog opening as everywhere else, at half a fold —
            a policy is read, not sold. */}
        <PageHero compact fog="editorial">
          <h1>{title}</h1>
          {intro && <p className="lp-page-lead">{intro}</p>}
          {updated && <p className="lp-page-meta">Last updated {updated}</p>}
        </PageHero>

        <article className="lp-article">
          <div className="lp-doc-body">{children}</div>
        </article>
      </main>

      <div className="dark" data-lp-tone="dark">
        <Footer />
      </div>
    </div>
  );
}
