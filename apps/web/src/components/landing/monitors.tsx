// Real brands shown only as "you can point Outrival at any of these" examples
// (nominative fair use) — each links out to the actual site. Fabricated example
// data elsewhere on the page uses fictional names, never these.
const MONITORED: { name: string; href: string }[] = [
  { name: "Linear", href: "https://linear.app" },
  { name: "Notion", href: "https://notion.so" },
  { name: "Vercel", href: "https://vercel.com" },
  { name: "Stripe", href: "https://stripe.com" },
  { name: "Asana", href: "https://asana.com" },
  { name: "Figma", href: "https://figma.com" },
  { name: "HubSpot", href: "https://hubspot.com" },
  { name: "Slack", href: "https://slack.com" },
  { name: "Loom", href: "https://loom.com" },
  { name: "Pitch", href: "https://pitch.com" },
  { name: "Airtable", href: "https://airtable.com" },
  { name: "Raycast", href: "https://raycast.com" },
];

export function Monitors() {
  return (
    <section className="border-y border-border bg-background-2 py-10">
      <div className="mx-auto w-full max-w-6xl px-6">
        <p className="text-center text-xs text-text-subtle">
          Point Outrival at any public SaaS — like these · set up in minutes
        </p>
        <div
          className="mt-6 flex flex-wrap items-center justify-center gap-x-8 gap-y-3 sm:gap-x-12"
          aria-label="Examples of SaaS brands you can monitor with Outrival"
        >
          {MONITORED.map(({ name, href }) => (
            <a
              key={name}
              href={href}
              target="_blank"
              rel="noopener noreferrer nofollow"
              className="rounded-sm text-base font-medium text-text-muted transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
            >
              {name}
            </a>
          ))}
        </div>
      </div>
    </section>
  );
}
