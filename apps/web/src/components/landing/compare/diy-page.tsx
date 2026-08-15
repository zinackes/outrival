import Link from "next/link";
import { ArrowRightIcon, CheckIcon, MinusIcon } from "@/components/icons";
import { Band, Breadcrumbs, CompareShell } from "./compare-shell";
import { CompareFaq } from "./compare-faq";
import { ProductProof } from "./product-proof";
import { DIY, LAST_REVIEWED, PRICE_AS_OF } from "./data";

// "Outrival vs doing it yourself." The ICP's real daily competitor: the free /
// near-free DIY stack. Same landing rhythm as the rest of /vs — paper argues,
// one graphite cut holds the evidence, paper carries the honest split.
//
// The two card grids that used to close the page (hidden costs, when DIY wins)
// are one two-column spread now: they are the same question asked from both
// sides, and reading them side by side is the point.

const ROW = "grid grid-cols-[1.3fr_1fr_1fr] sm:grid-cols-[1.5fr_1fr_1fr]";

const XLINKS = [
  {
    href: "/alternatives/best-competitive-intelligence-tools",
    label: "Best competitive-intelligence tools",
  },
  { href: "/vs/crayon", label: "Outrival vs Crayon" },
  { href: "/vs/klue", label: "Outrival vs Klue" },
  { href: "/alternatives/crayon", label: "Best Crayon alternatives" },
];

export function DiyPage() {
  return (
    <CompareShell>
      <header className="lp-page-head">
        <Breadcrumbs
          items={[
            { name: "Home", path: "/" },
            { name: "Outrival vs doing it yourself", path: "/vs/diy" },
          ]}
        />
        <h1>
          Outrival vs doing it{" "}
          <span className="lp-serif-accent">yourself</span>
        </h1>
        {DIY.verdict.map((line, i) => (
          <p key={i} className="lp-page-lead">
            {line}
          </p>
        ))}
        <p className="lp-page-meta">
          Last reviewed {LAST_REVIEWED} · compared on publicly available
          information
        </p>
        <div className="lp-page-ctas">
          <a className="lp-btn-accent lp-btn-hero" href="/auth">
            Start free
          </a>
          <Link href="/pricing" className="lp-link-sample">
            See all plans
          </Link>
        </div>
      </header>

      <Band tone="dark">
        <div className="lp-block">
          <div className="lp-head">
            <h2>
              The stack, side by <span className="lp-serif-accent">side</span>.
            </h2>
            <p>
              What the DIY stack does versus what Outrival does, on the jobs a
              buyer decides on.
            </p>
          </div>
          <div className="mt-10 overflow-x-auto">
            <div className="min-w-[640px] border-t border-border-strong">
              <div
                className={`${ROW} border-b border-border text-meta font-medium uppercase tracking-[0.06em] text-text-subtle`}
              >
                <div className="px-4 py-3" />
                <div className="px-4 py-3">Doing it yourself</div>
                <div className="bg-primary/[0.05] px-4 py-3 text-primary">
                  Outrival
                </div>
              </div>
              {DIY.table.map((r) => (
                <div
                  key={r.label}
                  className={`${ROW} border-b border-border text-dense last:border-b-0`}
                >
                  <div className="px-4 py-3.5 text-text-subtle">{r.label}</div>
                  <div className="px-4 py-3.5 text-text-muted">{r.diy}</div>
                  <div className="bg-primary/[0.05] px-4 py-3.5 font-medium">
                    {r.outrival}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="lp-block">
          <ProductProof lead="If your competitor set has outgrown the free tools, this is what replaces the stack: every move in one place, written up, ready to act on." />
        </div>
      </Band>

      <Band tone="paper">
        <div className="lp-block">
          <div className="lp-head">
            <h2>
              What the DIY stack actually{" "}
              <span className="lp-serif-accent">is</span>.
            </h2>
            <p>
              Three honest tools, each good at its job. Here&apos;s what each
              does well, where it breaks, and what it costs.
            </p>
          </div>
          <ol className="lp-tools is-flat">
            {DIY.approaches.map((a) => (
              <li key={a.name}>
                <div className="lp-tool-body">
                  <div className="lp-tool-head">
                    <h3>{a.name}</h3>
                    <span className="lp-tool-best">{a.role}</span>
                  </div>
                  <p className="lp-tool-line">
                    <CheckIcon size={16} className="text-primary" aria-hidden />
                    <span>{a.doesWell}</span>
                  </p>
                  <p className="lp-tool-line lp-tool-trade">
                    <MinusIcon size={16} aria-hidden />
                    <span>{a.breaks}</span>
                  </p>
                  {"alternative" in a && a.alternative && (
                    <p className="lp-tool-trade">{a.alternative}</p>
                  )}
                  <div className="lp-tool-foot">
                    <span>{a.cost}</span>
                  </div>
                </div>
              </li>
            ))}
          </ol>
          <div className="lp-sources">
            <p>
              Tool pricing is each vendor&apos;s public list price as of{" "}
              {PRICE_AS_OF} and can change.
            </p>
          </div>
        </div>

        <div className="lp-block">
          <div className="lp-head">
            <h2>
              What it really <span className="lp-serif-accent">costs</span>.
            </h2>
            <p>
              The cash cost of the DIY stack is low; the real bill is time and
              judgement. We&apos;d rather tell you than sell you, so the cases
              where the free tools are the honest answer sit right next to it.
            </p>
          </div>
          <div className="lp-twoup">
            <div>
              <h3>The hidden costs of rolling your own</h3>
              <ul>
                {DIY.hiddenCosts.map((h) => (
                  <li key={h.title}>
                    <MinusIcon
                      size={16}
                      className="text-text-subtle"
                      aria-hidden
                    />
                    <p>
                      <b>{h.title}.</b> {h.body}
                    </p>
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <h3>When doing it yourself is the right call</h3>
              <ul>
                {DIY.whenDiyWins.map((w) => (
                  <li key={w.title}>
                    <CheckIcon size={16} className="text-primary" aria-hidden />
                    <p>
                      <b>{w.title}.</b> {w.body}
                    </p>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </Band>

      <Band tone="paper">
        <CompareFaq
          heading={
            <>
              Outrival vs DIY,{" "}
              <span className="lp-serif-accent">answered</span>.
            </>
          }
          faqs={DIY.faqs}
        />

        <div className="lp-final">
          <h2>
            Stop maintaining the stack. Read the{" "}
            <span className="lp-serif-accent">brief</span> instead.
          </h2>
          <p className="sub-f">
            Add two competitors on the free plan and get your first AI-written
            brief this week, with no selectors to maintain and no diffs to read.
          </p>
          <a className="lp-btn-accent" href="/auth">
            Start free
          </a>
          <p className="lp-final-micro">
            No credit card · cancel in one click ·{" "}
            <Link href="/pricing">see all plans</Link>
          </p>
        </div>

        <div className="lp-xlinks">
          {XLINKS.map((l) => (
            <Link key={l.href} href={l.href}>
              {l.label}
              <ArrowRightIcon size={14} aria-hidden />
            </Link>
          ))}
        </div>

        <div className="lp-sources">
          <p>
            Comparison based on publicly available information as of{" "}
            {PRICE_AS_OF}. DIY-tool figures are each vendor&apos;s own published
            pricing and can change. Outrival is independent and not affiliated
            with the tools named; all trademarks belong to their respective
            owners.
          </p>
          <p>
            Outrival offers EU data storage, see our{" "}
            <Link href="/security">security overview</Link> for specifics.
          </p>
          <p>
            Sources:{" "}
            {DIY.sources.map((s, i) => (
              <span key={s.href}>
                {i > 0 && " · "}
                <a
                  href={s.href}
                  target="_blank"
                  rel="nofollow noopener noreferrer"
                >
                  {s.label}
                </a>
              </span>
            ))}
            .
          </p>
        </div>
      </Band>
    </CompareShell>
  );
}
