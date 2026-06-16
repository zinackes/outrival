import { Boxes, MessageSquare, Radar, Swords } from "lucide-react";

const FEATURES = [
  {
    icon: MessageSquare,
    title: "Ask Outrival",
    desc: "Ask in plain English — “how did Linear's pricing move this quarter?” — and get an answer grounded on the data we already track, deep-linked back to the signal it came from.",
  },
  {
    icon: Swords,
    title: "Battle cards",
    desc: "AI-generated battle cards per competitor: six editable sections, exportable to PDF. They flag themselves for a refresh when the underlying signals move.",
  },
  {
    icon: Radar,
    title: "Competitor discovery",
    desc: "Every week we surface look-alike competitors you aren't tracking yet — semantic search across the market, scored by overlap. Add one in a click.",
  },
  {
    icon: Boxes,
    title: "Multiple products",
    desc: "Track more than one of your own SKUs. Every signal is tagged to the products it actually affects, so each line gets its own competitive feed.",
  },
] as const;

export function Capabilities() {
  return (
    <section className="py-16 sm:py-24" id="features">
      <div className="mx-auto w-full max-w-6xl px-6">
        <div className="grid gap-x-10 gap-y-4 lg:grid-cols-2 lg:items-end">
          <h2 className="text-3xl font-semibold leading-tight tracking-tight sm:text-4xl">
            More than a<br />
            Monday email.
          </h2>
          <p className="leading-relaxed text-text-muted">
            The digest is the heartbeat. Around it, the dashboard does the work a
            competitive-intelligence analyst would — on every signal, every week.
          </p>
        </div>

        <div className="mt-14 grid grid-cols-1 gap-x-12 gap-y-12 sm:grid-cols-2">
          {FEATURES.map((f) => (
            <div key={f.title} className="border-t border-border-strong pt-5">
              <f.icon size={18} className="text-primary" />
              <h3 className="mt-3 text-xl font-semibold tracking-tight">
                {f.title}
              </h3>
              <p className="mt-2 max-w-md text-sm leading-relaxed text-text-muted">
                {f.desc}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
