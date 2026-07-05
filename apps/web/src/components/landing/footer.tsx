import { CookiePreferencesButton } from "@/components/legal/cookie-preferences-button";

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
    <footer className="border-t border-border bg-background-2">
      <div className="mx-auto w-full max-w-6xl px-6 py-12">
        <div className="grid gap-10 md:grid-cols-[1.5fr_2fr]">
          <div>
            <a href="/" className="text-lg font-semibold tracking-tight">
              Out<span className="text-primary">rival</span>
            </a>
            <p className="mt-3 max-w-xs text-sm text-text-muted">
              Competitive intelligence isn&apos;t a weekly calendar slot
              anymore. It&apos;s a Monday morning brief.
            </p>
            <div className="mt-4 inline-flex items-center gap-2 text-xs text-text-subtle">
              <span className="size-1.5 rounded-full bg-positive" /> Made in
              Paris · hosted in EU
            </div>
          </div>
          <div className="grid grid-cols-2 gap-8 sm:grid-cols-3 lg:grid-cols-5">
            <FooterCol
              head="Product"
              links={[
                { label: "Sources", href: "/#sources" },
                { label: "Pipeline", href: "/#pipeline" },
                { label: "Signals", href: "/#signals" },
                { label: "Compare", href: "/#compare" },
                { label: "Pricing", href: "/#pricing" },
              ]}
            />
            <FooterCol
              head="Compare"
              links={[
                { label: "vs Crayon", href: "/vs/crayon" },
                { label: "vs Klue", href: "/vs/klue" },
                { label: "Crayon alternatives", href: "/alternatives/crayon" },
                { label: "Klue alternatives", href: "/alternatives/klue" },
              ]}
            />
            <FooterCol
              head="Company"
              links={[
                { label: "About", href: "/about" },
                { label: "Contact", href: "mailto:hello@outrival.app" },
              ]}
            />
            <FooterCol
              head="Resources"
              links={[
                { label: "Blog", href: "/blog" },
                { label: "FAQ", href: "/#faq" },
                { label: "Changelog", href: "/changelog" },
                { label: "API docs", href: "/docs" },
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
