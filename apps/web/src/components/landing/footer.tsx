import { CookiePreferencesButton } from "@/components/legal/cookie-preferences-button";
import { LogoMark } from "@/components/outrival/logo";

function FooterCol({
  head,
  links,
}: {
  head: string;
  links: { label: string; href: string }[];
}) {
  return (
    <div className="flex flex-col gap-2.5 text-sm">
      <div className="mb-1 text-xs font-medium text-text-subtle">
        {head}
      </div>
      {links.map((l) => (
        <a
          key={l.label}
          href={l.href}
          className="text-text-muted transition-colors hover:text-foreground"
        >
          {l.label}
        </a>
      ))}
    </div>
  );
}

export function Footer() {
  return (
    // text-foreground is explicit because the footer is rendered inside a
    // .dark region hung off a pinned-light canvas: without it the wordmark's
    // "Out" inherited the canvas ink and disappeared into the dark surface.
    <footer className="border-t border-border bg-background-2 text-foreground">
      <div className="mx-auto w-full max-w-6xl px-6 py-12">
        <div className="grid gap-10 md:grid-cols-[1.5fr_2fr]">
          <div>
            <a
              href="/"
              className="inline-flex items-center gap-2 text-lg font-semibold tracking-tight"
            >
              <LogoMark size={26} />
              Out<span className="text-primary">rival</span>
            </a>
            <p className="mt-3 max-w-xs text-sm text-text-muted">
              Competitive intelligence isn&apos;t a weekly calendar slot
              anymore. It&apos;s a Monday morning brief.
            </p>
            <div className="mt-4 inline-flex items-center gap-2 text-xs text-text-subtle">
              <span className="size-1.5 rounded-full bg-positive" /> Made in
              France · hosted in EU
            </div>
          </div>
          <div className="grid grid-cols-2 gap-8 sm:grid-cols-3 lg:grid-cols-5">
            <FooterCol
              head="Product"
              links={[
                { label: "Product", href: "/#product" },
                { label: "Signals", href: "/#signals" },
                { label: "Compare", href: "/#compare" },
                { label: "Pricing", href: "/pricing" },
              ]}
            />
            <FooterCol
              head="Compare"
              links={[
                { label: "vs Crayon", href: "/vs/crayon" },
                { label: "vs Klue", href: "/vs/klue" },
                { label: "vs Doing it yourself", href: "/vs/diy" },
                {
                  label: "Best CI tools",
                  href: "/alternatives/best-competitive-intelligence-tools",
                },
                { label: "Crayon alternatives", href: "/alternatives/crayon" },
                { label: "Klue alternatives", href: "/alternatives/klue" },
              ]}
            />
            <FooterCol
              head="Company"
              links={[
                { label: "About", href: "/about" },
                { label: "Security", href: "/security" },
                { label: "Contact", href: "mailto:hello@outrival.app" },
              ]}
            />
            <FooterCol
              head="Resources"
              links={[
                { label: "Blog", href: "/blog" },
                { label: "FAQ", href: "/#faq" },
                { label: "Changelog", href: "/changelog" },
                { label: "API (coming soon)", href: "/docs" },
              ]}
            />
            <FooterCol
              head="Legal"
              links={[
                { label: "Legal notice", href: "/legal-notice" },
                { label: "Privacy", href: "/privacy" },
                { label: "Cookies", href: "/cookies" },
                { label: "Terms", href: "/terms" },
                { label: "All legal", href: "/legal" },
              ]}
            />
          </div>
        </div>
        <div className="mt-10 flex flex-col gap-3 border-t border-border pt-6 text-xs text-text-subtle sm:flex-row sm:items-center sm:justify-between">
          <div>© 2026 Outrival</div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
            <span>v0.7.0</span>
            <CookiePreferencesButton className="transition-colors hover:text-foreground">
              Cookie preferences
            </CookiePreferencesButton>
            <a href="/legal" className="transition-colors hover:text-foreground">
              Legal
            </a>
            <a
              href="/status"
              className="transition-colors hover:text-foreground"
            >
              Status
            </a>
          </div>
        </div>
      </div>
    </footer>
  );
}
