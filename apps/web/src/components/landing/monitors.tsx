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
    <section className="monitors">
      <div className="wrap monitors-grid">
        <div className="monitors-label">
          <div className="eyebrow">Demo · monitored right now</div>
          <div className="monitors-sub">
            12 public brands scraped for the live demo. Plug in your own in 10
            minutes.
          </div>
        </div>
        <div
          className="monitors-marks"
          aria-label="Competitors monitored in the live demo"
        >
          {MONITORED.map((name) => (
            <span key={name} className="mark">
              {name}
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}
