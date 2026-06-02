const MONITORED = [
  "Linear",
  "Notion",
  "Vercel",
  "Stripe",
  "Asana",
  "Figma",
  "HubSpot",
  "Slack",
  "Loom",
  "Pitch",
  "Cron",
  "Raycast",
];

export function Monitors() {
  return (
    <section className="py-12">
      <div className="mx-auto grid w-full max-w-6xl grid-cols-1 gap-6 px-6 md:grid-cols-[auto_1fr] md:items-center md:gap-12">
        <div>
          <div className="font-mono text-xs uppercase tracking-[0.2em] text-text-subtle">
            Demo · monitored right now
          </div>
          <div className="mt-1 max-w-xs text-sm text-text-muted">
            12 public brands scraped for the live demo. Plug in your own in 10
            minutes.
          </div>
        </div>
        <div
          className="flex flex-wrap gap-2"
          aria-label="Competitors monitored in the live demo"
        >
          {MONITORED.map((name) => (
            <span
              key={name}
              className="rounded-md border border-border bg-surface px-3 py-1.5 font-mono text-sm text-text-muted"
            >
              {name}
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}
