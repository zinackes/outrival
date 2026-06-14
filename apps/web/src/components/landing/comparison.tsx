type Tone = "no" | "partial" | "yes";

type Cmp = { text: string; tone: Tone };

type Row = { label: string; manual: Cmp; legacy: Cmp; us: string };

const ROWS: Row[] = [
  {
    label: "Continuous scraping, zero re-wiring",
    manual: { text: "no", tone: "no" },
    legacy: { text: "partial", tone: "partial" },
    us: "yes · 15+ sources",
  },
  {
    label: "Strategic insight generated (so-what + action)",
    manual: { text: "write it yourself", tone: "no" },
    legacy: { text: "templates", tone: "partial" },
    us: "frontier LLM",
  },
  {
    label: "Noise filtered before analysis",
    manual: { text: "no", tone: "no" },
    legacy: { text: "everything passes through", tone: "no" },
    us: "Llama 70B classifier",
  },
  {
    label: "Real-time alert on critical signal",
    manual: { text: "no", tone: "no" },
    legacy: { text: "email batch", tone: "partial" },
    us: "Slack < 5 min",
  },
  {
    label: "Data hosted in EU",
    manual: { text: "depends on tools", tone: "partial" },
    legacy: { text: "mostly US", tone: "no" },
    us: "OVH · Neon (EU)",
  },
  {
    label: "Setup",
    manual: { text: "2h / week", tone: "partial" },
    legacy: { text: "2-4 weeks", tone: "partial" },
    us: "10 minutes",
  },
  {
    label: "Typical monthly cost",
    manual: { text: "8h × salary", tone: "partial" },
    legacy: { text: "$800–$2k", tone: "partial" },
    us: "€29 to €199",
  },
];

const TONE: Record<Tone, string> = {
  no: "text-text-subtle",
  partial: "text-medium",
  yes: "text-positive",
};

const ROW = "grid grid-cols-[1.6fr_1fr_1fr_1fr]";

export function Comparison() {
  return (
    <section className="py-20 sm:py-28" id="compare">
      <div className="mx-auto w-full max-w-6xl px-6">
        <div className="grid gap-x-10 gap-y-4 lg:grid-cols-2 lg:items-end">
          <h2 className="text-3xl font-semibold leading-tight tracking-tight sm:text-4xl">
            Vs doing it by hand.
            <br />
            Vs the legacy tools.
          </h2>
          <p className="text-text-muted leading-relaxed">
            Three approaches exist. Manual tracking (a weekly calendar slot and
            a Notion), the legacy battle-card tools (Klue, Crayon), and us.
            Here&apos;s what changes.
          </p>
        </div>

        <div className="mt-10 overflow-x-auto">
          <div className="min-w-[640px] overflow-hidden rounded-xl border border-border">
            <div
              className={`${ROW} border-b border-border bg-background-2 font-mono text-xs uppercase tracking-wider text-text-subtle`}
            >
              <div className="px-4 py-3" />
              <div className="px-4 py-3">Manual</div>
              <div className="px-4 py-3">Legacy CI</div>
              <div className="bg-primary/5 px-4 py-3 text-primary">
                Outrival
              </div>
            </div>
            {ROWS.map((r) => (
              <div
                key={r.label}
                className={`${ROW} border-b border-border text-sm last:border-b-0`}
              >
                <div className="px-4 py-3 text-text-muted">{r.label}</div>
                <div className={`px-4 py-3 ${TONE[r.manual.tone]}`}>
                  {r.manual.text}
                </div>
                <div className={`px-4 py-3 ${TONE[r.legacy.tone]}`}>
                  {r.legacy.text}
                </div>
                <div className="bg-primary/5 px-4 py-3 text-positive">
                  {r.us}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
