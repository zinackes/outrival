import {
  PulseIcon,
  ArrowRightIcon,
  BriefcaseIcon,
  CpuIcon,
  FileTextIcon,
  GlobeIcon,
  NewspaperIcon,
  RssIcon,
  StarIcon,
  TagIcon,
} from "@phosphor-icons/react/ssr";
import type { Icon as PhosphorIcon } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";

type Source = { icon: PhosphorIcon; label: string; meta: string };

const FAMILIES: {
  title: string;
  stat: string;
  desc: string;
  sources: Source[];
}[] = [
  {
    title: "The public product",
    stat: "≈60% of signals",
    desc: "Everything they show their own prospects, the densest layer.",
    sources: [
      { icon: GlobeIcon, label: "Homepage", meta: "positioning" },
      { icon: TagIcon, label: "Pricing page", meta: "plans · prices" },
      { icon: RssIcon, label: "Blog", meta: "editorial" },
      { icon: FileTextIcon, label: "Changelog", meta: "releases" },
      { icon: PulseIcon, label: "Status page", meta: "uptime" },
    ],
  },
  {
    title: "The users",
    stat: "2 platforms",
    desc: "What their actual customers say: score, volume, and how it's trending.",
    sources: [
      { icon: StarIcon, label: "App Store", meta: "reviews" },
      { icon: StarIcon, label: "Trustpilot", meta: "score · trend" },
    ],
  },
  {
    title: "Hiring & momentum",
    stat: "weeks of lead",
    desc: "The earliest indicators of strategic moves, often before the announcement.",
    sources: [
      { icon: BriefcaseIcon, label: "Job postings", meta: "roles" },
      { icon: CpuIcon, label: "Tech stack", meta: "payments · CRM" },
      { icon: NewspaperIcon, label: "News", meta: "funding · M&A" },
    ],
  },
];

export function Sources() {
  return (
    <section className="py-16 sm:py-24" id="sources" data-reveal>
      <div className="mx-auto w-full max-w-6xl px-6">
        <div className="max-w-3xl">
          <h2 className="text-3xl font-semibold leading-tight tracking-tight sm:text-4xl">
            Everything a competitor publishes.
          </h2>
          <p className="mt-5 max-w-2xl leading-relaxed text-text-muted">
            Every public surface a competitor has, grouped into families. We
            respect robots.txt, identify our crawler on every request, and collect
            only what a site publishes openly, never bypassing a block, login, or
            paywall. Everything is stored in the EU and diffed against its previous
            state.
          </p>
        </div>

        <div className="mt-14 grid grid-cols-1 gap-x-12 gap-y-12 sm:grid-cols-2 lg:grid-cols-3">
          {FAMILIES.map((fam) => (
            <div key={fam.title}>
              <div className="flex items-baseline justify-between gap-3 border-t border-border-strong pt-4">
                <h3 className="text-xl font-semibold tracking-tight">
                  {fam.title}
                </h3>
                <span className="shrink-0 text-xs font-medium text-primary">
                  {fam.stat}
                </span>
              </div>
              <p className="mt-2.5 text-sm leading-relaxed text-text-muted">
                {fam.desc}
              </p>
              <ul className="mt-4">
                {fam.sources.map((s) => (
                  <li
                    key={s.label}
                    className="group -mx-2 flex items-center gap-3 rounded-md px-2 py-2 transition-colors hover:bg-surface"
                  >
                    <s.icon
                      size={15}
                      className="shrink-0 text-text-subtle transition-colors group-hover:text-primary"
                    />
                    <span className="text-sm font-medium">{s.label}</span>
                    <span className="ml-auto text-xs text-text-subtle">
                      {s.meta}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        {/* Your own product — the closing moment. */}
        <div className="mt-12 flex flex-wrap items-center justify-between gap-6 border-t border-primary/70 pt-6">
          <div className="max-w-2xl">
            <span className="text-meta font-medium text-primary">
              Every plan
            </span>
            <h3 className="mt-2 text-xl font-semibold tracking-tight">
              Your own product, side by side
            </h3>
            <p className="mt-2 text-sm leading-relaxed text-text-muted">
              Point the same pipeline at your live site, your pricing, even a
              GitHub repo while you&apos;re still building. Your changes get
              classified too, so the digest reads your moves against theirs.
            </p>
          </div>
          <Button asChild size="lg">
            <a href="/auth">
              Add your product free <ArrowRightIcon size={15} />
            </a>
          </Button>
        </div>
      </div>
    </section>
  );
}
