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
        <p className="text-center font-mono text-xs text-text-subtle">
          Tracking 12 public SaaS brands live · plug in your own in 10 minutes
        </p>
        <div
          className="mt-6 flex flex-wrap items-center justify-center gap-x-8 gap-y-3 sm:gap-x-12"
          aria-label="Competitors monitored in the live demo"
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
