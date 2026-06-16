import { Button } from "@/components/ui/button";

// The signature is an activity timeline: each bar is a week of monitoring, its
// height the volume of changes scanned. A handful ran hot — they became signals,
// surfaced on hover. Real product behaviour, not decoration.
const SPECTRUM = [
  20, 34, 28, 46, 30, 58, 40, 70, 52, 90, 64, 110, 78, 140, 96, 170, 120, 150,
  88, 130, 72, 108, 60, 84, 150, 200, 160, 120, 180, 130, 96, 150, 108, 76, 120,
  64, 100, 52, 84, 44, 70, 36, 58, 30, 46, 26, 38, 22, 30, 18,
];
// Hot weeks → the detection shown on hover. Kept to the central bars so the
// tooltip never collides with the section's edges.
const SIGNALS: Record<
  number,
  { competitor: string; category: string; detail: string }
> = {
  13: { competitor: "Notion", category: "hiring", detail: "opens 3 AI Research roles — first EU team" },
  15: { competitor: "Linear", category: "pricing", detail: "Business plan $16 → $14/seat" },
  24: { competitor: "Asana", category: "reviews", detail: "G2 score slips 4.4 → 4.2" },
  28: { competitor: "Stripe", category: "product", detail: "launches usage-based billing" },
  31: { competitor: "Coda", category: "funding", detail: "raises Series E, $200M" },
};

export function Hero() {
  return (
    <section className="relative isolate flex min-h-[112vh] flex-col overflow-hidden">
      {/* One restrained glow behind the statement; no dot grid, no gradient text. */}
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
        <div
          className="absolute left-1/2 top-24 h-[34rem] w-[60rem] max-w-[120vw] -translate-x-1/2 rounded-full opacity-50 blur-[150px]"
          style={{
            background:
              "radial-gradient(circle, color-mix(in srgb, var(--accent) 11%, transparent) 0%, transparent 65%)",
          }}
        />
      </div>

      {/* Statement — vertically centred in the space above the timeline. */}
      <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col items-center justify-center px-6 pb-10 pt-24 text-center">
        <h1 className="text-[clamp(3rem,6vw,5rem)] font-semibold leading-[1.02] tracking-[-0.02em] text-balance">
          Competitive intelligence,
          <br className="hidden sm:block" /> written by AI.
        </h1>

        <p className="mx-auto mt-6 max-w-xl text-lg leading-relaxed text-text-muted text-pretty">
          Outrival watches every public move your competitors make and tells you
          the one thing that matters, every Monday.
        </p>

        <div className="mt-9 flex flex-wrap items-center justify-center gap-3">
          <Button asChild size="lg">
            <a href="#cta">Start monitoring free</a>
          </Button>
          <Button asChild size="lg" variant="outline">
            <a href="#digest">See a sample digest</a>
          </Button>
        </div>

        <p className="mt-6 font-mono text-xs text-text-subtle">
          No card · 2 competitors free · Cancel anytime · Hosted in the EU
        </p>
      </div>

      {/* The timeline, anchored to the bottom of the (taller-than-viewport) hero. */}
      <div className="px-6 pb-1">
        <p className="mb-5 text-center font-mono text-xs text-text-subtle">
          A year of monitoring · each bar a week · the bright ones became signals
        </p>
        <div aria-hidden className="flex h-64 items-end justify-center gap-[5px]">
          {SPECTRUM.map((h, i) => {
            const sig = SIGNALS[i];
            return (
              <div
                key={i}
                style={{ height: `${h}px` }}
                className={`group relative w-[5px] shrink-0 rounded-[3px] transition-opacity duration-150 ${
                  sig
                    ? "cursor-default bg-primary opacity-90 hover:opacity-100"
                    : "bg-text-muted opacity-25 hover:opacity-60"
                }`}
              >
                {sig && (
                  <span className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-3 -translate-x-1/2 whitespace-nowrap rounded-md border border-border bg-surface px-3 py-1.5 text-xs opacity-0 shadow-lg transition-opacity duration-150 group-hover:opacity-100">
                    <span className="text-text-subtle">{sig.category}</span>
                    {" · "}
                    <span className="font-semibold">{sig.competitor}</span>{" "}
                    <span className="text-text-muted">{sig.detail}</span>
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
