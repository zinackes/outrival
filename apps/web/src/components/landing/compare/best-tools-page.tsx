import Link from "next/link";
import { ArrowRightIcon } from "@/components/icons";
import { Band, Breadcrumbs, CompareShell } from "./compare-shell";
import { CompareFaq } from "./compare-faq";
import { GlanceTable } from "./glance-table";
import { ProductProof } from "./product-proof";
import { ItemListJsonLd } from "./structured-data";
import { BEST_TOOLS, LAST_REVIEWED, PRICE_AS_OF } from "./data";

// Category hub: "Best competitive intelligence tools (2026)", on the landing's
// rhythm — paper asks, graphite holds the evidence, paper carries the survey.
//
// It stays a survey and not a ranking with Outrival forced to #1, so the stack
// runs flat: no numeral in the gutter, only an honest "best for". The direct
// answer opens the list as the paragraph an LLM can lift verbatim.

const XLINKS = [
  { href: "/vs/crayon", label: "Outrival vs Crayon" },
  { href: "/vs/klue", label: "Outrival vs Klue" },
  { href: "/vs/diy", label: "Outrival vs doing it yourself" },
  { href: "/alternatives/crayon", label: "Best Crayon alternatives" },
];

export function BestToolsPage() {
  return (
    <CompareShell>
      <ItemListJsonLd
        name={`Best competitive intelligence tools (${PRICE_AS_OF})`}
        items={BEST_TOOLS.items.map((it) => it.name)}
      />

      <header className="lp-page-head">
        <Breadcrumbs
          items={[
            { name: "Home", path: "/" },
            {
              name: "Best competitive intelligence tools",
              path: "/alternatives/best-competitive-intelligence-tools",
            },
          ]}
        />
        <h1>
          Best competitive <span className="lp-serif-accent">intelligence</span>{" "}
          tools in 2026
        </h1>
        <p className="lp-page-lead">{BEST_TOOLS.intro}</p>
        <p className="lp-page-meta">
          Last reviewed {LAST_REVIEWED} · compared on publicly available
          information
        </p>
        <div className="lp-page-ctas">
          <a className="lp-btn-accent lp-btn-hero" href="/auth">
            Start free
          </a>
          <Link href="/pricing" className="lp-link-sample">
            See pricing
          </Link>
        </div>
      </header>

      <Band tone="dark">
        <div className="lp-block">
          <div className="lp-head">
            <h2>
              At a <span className="lp-serif-accent">glance</span>.
            </h2>
            <p>
              What each tool is for, what it costs to start, and whether you can
              start at all without booking a call.
            </p>
          </div>
          <GlanceTable
            items={BEST_TOOLS.items}
            note={`Prices for the sales-led tools are third-party estimates; those vendors do not publish public pricing. Self-serve prices are the vendors' own list. As of ${PRICE_AS_OF}.`}
          />
        </div>

        <div className="lp-block">
          <ProductProof />
        </div>
      </Band>

      <Band tone="paper">
        <div className="lp-head">
          <h2>
            Each one, <span className="lp-serif-accent">honestly</span>.
          </h2>
          <p>
            This isn&apos;t a strict 1-to-6 ranking, because the right tool
            depends on who you are. Every entry carries its tradeoff, including
            ours.
          </p>
        </div>

        <div className="lp-answer">
          <span>The short answer</span>
          <p>{BEST_TOOLS.directAnswer}</p>
        </div>

        <ol className="lp-tools is-flat">
          {BEST_TOOLS.items.map((it) => (
            <li key={it.name} className={it.self ? "is-self" : undefined}>
              <div className="lp-tool-body">
                <div className="lp-tool-head">
                  <h3>{it.name}</h3>
                  {it.self ? (
                    <span className="lp-tool-pick">
                      Our pick for founders &amp; small teams
                    </span>
                  ) : (
                    <span className="lp-tool-best">{it.bestFor}</span>
                  )}
                </div>
                <p>{it.body}</p>
                <p className="lp-tool-trade">
                  <b>The tradeoff:</b> {it.tradeoff}
                </p>
                <div className="lp-tool-foot">
                  <span>{it.entryPrice}</span>
                  {it.self ? (
                    <Link href="/auth">
                      Start free
                      <ArrowRightIcon size={14} aria-hidden />
                    </Link>
                  ) : it.href ? (
                    <Link href={it.href}>
                      Outrival vs {it.name}
                      <ArrowRightIcon size={14} aria-hidden />
                    </Link>
                  ) : null}
                </div>
              </div>
            </li>
          ))}
        </ol>
      </Band>

      <Band tone="paper">
        <CompareFaq
          heading={
            <>
              Choosing a CI tool,{" "}
              <span className="lp-serif-accent">answered</span>.
            </>
          }
          faqs={BEST_TOOLS.faqs}
        />

        <div className="lp-final">
          <h2>
            The self-serve pick, <span className="lp-serif-accent">free</span> to
            try.
          </h2>
          <p className="sub-f">
            If you&apos;re a founder or small team, skip the demos. Add two
            competitors on the free plan and read your first AI-written brief
            this week.
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
            {PRICE_AS_OF}. The sales-led tools do not publish public pricing;
            their figures are dated third-party estimates and vary by seats,
            competitors tracked and contract terms. Self-serve prices are the
            vendors&apos; own published list. Outrival is independent and not
            affiliated with the vendors named; all trademarks belong to their
            respective owners.
          </p>
          <p>
            Outrival offers EU data storage, see our{" "}
            <Link href="/security">security overview</Link> for specifics.
          </p>
          <p>
            Sources:{" "}
            {BEST_TOOLS.sources.map((s, i) => (
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
