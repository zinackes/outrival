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
          <div className="grid grid-cols-2 gap-8 sm:grid-cols-3">
            <FooterCol
              head="Product"
              links={[
                { label: "Sources", href: "#sources" },
                { label: "Pipeline", href: "#pipeline" },
                { label: "Signals", href: "#signals" },
                { label: "Compare", href: "#compare" },
                { label: "Pricing", href: "#pricing" },
              ]}
            />
            <FooterCol
              head="Resources"
              links={[
                { label: "FAQ", href: "#faq" },
                { label: "Changelog", href: "/changelog" },
                { label: "API docs", href: "/docs" },
                { label: "Contact", href: "mailto:hello@outrival.app" },
              ]}
            />
            <FooterCol
              head="Legal"
              links={[
                { label: "Terms", href: "/terms" },
                { label: "Privacy", href: "/privacy" },
                { label: "DPA", href: "/dpa" },
                { label: "Status", href: "/status" },
              ]}
            />
          </div>
        </div>
        <div className="mt-10 flex flex-col gap-3 border-t border-border pt-6 text-xs text-text-subtle sm:flex-row sm:items-center sm:justify-between">
          <div>© 2026 Outrival SAS · 8 rue de la Paix, 75002 Paris</div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
            <span>RCS Paris 932 481 297</span>
            <span>v0.7.0</span>
            <a
              href="/status"
              className="inline-flex items-center gap-1.5 transition-colors hover:text-foreground"
            >
              <span className="size-1.5 rounded-full bg-positive" /> All systems
              operational
            </a>
          </div>
        </div>
      </div>
    </footer>
  );
}
