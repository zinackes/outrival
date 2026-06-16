import { Button } from "@/components/ui/button";

// Static activity spectrum — an abstract "continuous monitoring" signature, read
// as a signal envelope, not a UI screenshot. Hand-tuned heights (px); a few bars
// run hot (the moments that became signals). Decorative, so aria-hidden.
const SPECTRUM = [
  20, 34, 28, 46, 30, 58, 40, 70, 52, 90, 64, 110, 78, 140, 96, 170, 120, 150,
  88, 130, 72, 108, 60, 84, 150, 200, 160, 120, 180, 130, 96, 150, 108, 76, 120,
  64, 100, 52, 84, 44, 70, 36, 58, 30, 46, 26, 38, 22, 30, 18,
];
const HOT = new Set([13, 15, 25, 26, 28]);

export function Hero() {
  return (
    <section className="relative isolate overflow-hidden">
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

      <div className="mx-auto max-w-3xl px-6 pt-16 text-center sm:pt-24">
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

      {/* The signature: a continuous activity spectrum dissolving at both edges. */}
      <div
        aria-hidden
        className="mt-28 flex h-56 items-end justify-center gap-[5px] px-6 sm:mt-32"
        style={{
          maskImage:
            "linear-gradient(to right, transparent, #000 14%, #000 86%, transparent)",
          WebkitMaskImage:
            "linear-gradient(to right, transparent, #000 14%, #000 86%, transparent)",
        }}
      >
        {SPECTRUM.map((h, i) => (
          <span
            key={i}
            className={`w-[5px] shrink-0 rounded-[3px] ${
              HOT.has(i) ? "bg-primary opacity-90" : "bg-text-muted opacity-30"
            }`}
            style={{ height: `${h}px` }}
          />
        ))}
      </div>
    </section>
  );
}
