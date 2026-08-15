import type { ReactNode } from "react";
import { Nav } from "@/components/landing/nav";
import { Footer } from "@/components/landing/footer";

// Shared shell for /blog and its articles, on the same composition as the rest
// of the marketing site: paper canvas pinned light (.lp-light, so html.dark
// can't half-theme it), the landing bar that detaches into a floating pill on
// scroll, and the footer in the dark region the landing ends on.
//
// The theme toggle went with the old sticky header: on a canvas that pins its
// own light tokens the control had nothing left to switch.
export function BlogShell({ children }: { children: ReactNode }) {
  return (
    <div className="landing-canvas lp-light lp-page min-h-dvh font-sans antialiased">
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
