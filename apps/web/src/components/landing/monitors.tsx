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
    <section className="border-y border-border bg-background-2 py-10">
      <div className="mx-auto w-full max-w-6xl px-6">
        <p className="text-center text-xs text-text-subtle">
          Point Outrival at any public SaaS — like these · set up in minutes
        </p>
        <div
          className="mt-6 flex flex-wrap items-center justify-center gap-x-8 gap-y-3 sm:gap-x-12"
          aria-label="Examples of SaaS brands you can monitor with Outrival"
        >
          {MONITORED.map((name) => (
            <span
              key={name}
              className="text-base font-medium text-text-muted transition-colors hover:text-foreground"
            >
              {name}
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}
