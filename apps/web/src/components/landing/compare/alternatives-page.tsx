import Link from "next/link";
import { ArrowRightIcon } from "@/components/icons";
import { Band, Breadcrumbs, CompareShell } from "./compare-shell";
import { CompareFaq } from "./compare-faq";
import { GlanceTable } from "./glance-table";
import { ProductProof } from "./product-proof";
import { ItemListJsonLd } from "./structured-data";
import {
  ALTERNATIVES,
  LAST_REVIEWED,
  PRICE_AS_OF,
  type CompetitorKey,
} from "./data";

// The alternatives page on the landing's rhythm: paper states the question,
// one graphite band holds the evidence (the comparison table and the product
// itself), paper carries the survey, the questions and the close.
//
// The ranked list stopped being six cards. Cards framed six vendors as six
// competing offers; the page is one survey, so it reads as one hairline stack
// with the numeral in the gutter.
export function AlternativesPage({
  competitorKey,
}: {
  competitorKey: CompetitorKey;
}) {
  const data = ALTERNATIVES[competitorKey];
  const subject = data.subjectName;
  const otherKey: CompetitorKey =
    competitorKey === "crayon" ? "klue" : "crayon";
  const otherName = competitorKey === "crayon" ? "Klue" : "Crayon";

  const XLINKS = [
    { href: `/vs/${competitorKey}`, label: `Outrival vs ${subject}` },
    { href: `/alternatives/${otherKey}`, label: `Best ${otherName} alternatives` },
    {
      href: "/alternatives/best-competitive-intelligence-tools",
      label: "Best competitive-intelligence tools",
    },
    { href: "/vs/diy", label: "Outrival vs doing it yourself" },
  ];

  return (
    <CompareShell>
      <ItemListJsonLd
        name={`Best ${subject} alternatives (${PRICE_AS_OF})`}
        items={data.items.map((it) => it.name)}
      />

      <header className="lp-page-head">
        <Breadcrumbs
          items={[
            { name: "Home", path: "/" },
            {
              name: `${subject} alternatives`,
              path: `/alternatives/${competitorKey}`,
            },
          ]}
        />
        <h1>
          Best <span className="lp-serif-accent">{subject}</span> alternatives
          in 2026
        </h1>
        <p className="lp-page-lead">{data.intro}</p>
        <p className="lp-page-meta">
          Last reviewed {LAST_REVIEWED} · compared on publicly available
          information
        </p>
        <div className="lp-page-ctas">
          <a className="lp-btn-accent lp-btn-hero" href="/auth">
            Start free
          </a>
          <Link href={`/vs/${competitorKey}`} className="lp-link-sample">
            Outrival vs {subject}
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
            items={data.items}
            note={`Prices for the sales-led tools are third-party estimates; those vendors do not publish public pricing. As of ${PRICE_AS_OF}.`}
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
            The right tool depends on who you are. Every entry carries its
            tradeoff, including ours.
          </p>
        </div>
        <ol className="lp-tools">
          {data.items.map((it, i) => (
            <li key={it.name} className={it.self ? "is-self" : undefined}>
              <div className="lp-tool-rank">{String(i + 1).padStart(2, "0")}</div>
              <div className="lp-tool-body">
                <div className="lp-tool-head">
                  <h3>{it.name}</h3>
                  {it.self ? (
                    <span className="lp-tool-pick">Our pick for small teams</span>
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
              {subject} alternatives,{" "}
              <span className="lp-serif-accent">answered</span>.
            </>
          }
          faqs={data.faqs}
        />

        <div className="lp-final">
          <h2>
            The self-serve alternative,{" "}
            <span className="lp-serif-accent">free</span> to try.
          </h2>
          <p className="sub-f">
            Skip the demo. Add two competitors on the free plan and read your
            first AI-written brief this week.
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
            {PRICE_AS_OF}. The sales-led tools listed do not publish public
            pricing; figures are dated third-party estimates and vary by seats,
            competitors tracked and contract terms. Outrival is independent and
            not affiliated with the vendors named; all trademarks belong to
            their respective owners.
          </p>
          <p>
            Outrival offers EU data storage, see our{" "}
            <Link href="/security">security overview</Link> for specifics.
          </p>
          <p>
            Sources:{" "}
            {data.sources.map((s, i) => (
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
