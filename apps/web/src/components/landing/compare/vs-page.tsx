import Link from "next/link";
import { ArrowRightIcon, CheckIcon, MinusIcon } from "@/components/icons";
import { Band, Breadcrumbs, CompareShell } from "./compare-shell";
import { CompareTable } from "./compare-table";
import { PricingFaceOff } from "./pricing-face-off";
import { CompareFaq } from "./compare-faq";
import { ProductProof } from "./product-proof";
import {
  COMPETITORS,
  LAST_REVIEWED,
  OUTRIVAL_WINS,
  PRICE_AS_OF,
  type CompetitorKey,
} from "./data";

// The head-to-head page, run on the landing's rhythm: paper for the argument,
// one graphite cut for the evidence (feature table, the product itself, the two
// price lists), paper again for the honest split, the questions and the close.
//
// The evidence lives on dark deliberately. It is the part of the page a buyer
// scrolls to compare, and the graphite band is what marks it as a different
// mode of reading — the prose ends, the numbers start.
export function VsPage({ competitorKey }: { competitorKey: CompetitorKey }) {
  const c = COMPETITORS[competitorKey];
  const other: CompetitorKey = competitorKey === "crayon" ? "klue" : "crayon";
  const otherName = COMPETITORS[other].name;

  const XLINKS = [
    { href: `/vs/${other}`, label: `Outrival vs ${otherName}` },
    { href: `/alternatives/${c.key}`, label: `Best ${c.name} alternatives` },
    { href: `/alternatives/${other}`, label: `Best ${otherName} alternatives` },
    { href: "/vs/diy", label: "Outrival vs doing it yourself" },
    {
      href: "/alternatives/best-competitive-intelligence-tools",
      label: "Best competitive-intelligence tools",
    },
  ];

  return (
    <CompareShell>
      <header className="lp-page-head">
        <Breadcrumbs
          items={[
            { name: "Home", path: "/" },
            { name: `Outrival vs ${c.name}`, path: `/vs/${c.key}` },
          ]}
        />
        <h1>
          Outrival vs <span className="lp-serif-accent">{c.name}</span>
        </h1>
        {c.verdict.map((line, i) => (
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
          <Link href={`/alternatives/${c.key}`} className="lp-link-sample">
            See all {c.name} alternatives
          </Link>
        </div>
      </header>

      <Band tone="dark">
        <div className="lp-block">
          <div className="lp-head">
            <h2>
              Feature by <span className="lp-serif-accent">feature</span>.
            </h2>
            <p>
              How the two line up on the things a buyer decides on. {c.name} is
              the better tool for a staffed intelligence program; the table
              shows where Outrival is the better fit for a small team.
            </p>
          </div>
          <div className="mt-10">
            <CompareTable competitorKey={c.key} />
          </div>
        </div>

        <div className="lp-block">
          <ProductProof />
        </div>

        <div className="lp-block">
          <div className="lp-head">
            <h2>
              Pricing, side by <span className="lp-serif-accent">side</span>.
            </h2>
            <p>
              {c.name} is quote-based and sales-led, so its numbers are dated
              third-party estimates. Outrival&apos;s are its published list
              price.
            </p>
          </div>
          <div className="mt-10">
            <PricingFaceOff competitorKey={c.key} />
          </div>
        </div>
      </Band>

      <Band tone="paper">
        <div className="lp-head">
          <h2>
            Which one is <span className="lp-serif-accent">right</span> for you.
          </h2>
          <p>
            No tool wins every profile. Here is the honest split, so you pick
            the one that fits how you work.
          </p>
        </div>
        <div className="lp-twoup">
          <div>
            <h3>When {c.name} is the better choice</h3>
            <ul>
              {c.betterWhen.map((b) => (
                <li key={b.title}>
                  <MinusIcon size={16} className="text-text-subtle" aria-hidden />
                  <p>
                    <b>{b.title}.</b> {b.body}
                  </p>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <h3>When Outrival wins</h3>
            <ul>
              {OUTRIVAL_WINS.map((b) => (
                <li key={b.title}>
                  <CheckIcon size={16} className="text-primary" aria-hidden />
                  <p>
                    <b>{b.title}.</b> {b.body}
                  </p>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </Band>

      <Band tone="paper">
        <CompareFaq
          heading={
            <>
              Outrival vs {c.name},{" "}
              <span className="lp-serif-accent">answered</span>.
            </>
          }
          faqs={c.faqs}
        />

        <div className="lp-final">
          <h2>
            Get your first competitor brief in{" "}
            <span className="lp-serif-accent">three minutes</span>.
          </h2>
          <p className="sub-f">
            No demo, no annual contract. Add two competitors on the free plan
            and see the Monday brief for yourself.
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

        {/* Sources and the affiliation disclaimer: the part a sceptical reader
            checks before believing the table above it. */}
        <div className="lp-sources">
          <p>
            Comparison based on publicly available information as of{" "}
            {PRICE_AS_OF}. {c.name} does not publish public pricing; figures are
            third-party estimates and vary by seats, competitors tracked and
            contract terms. Outrival is independent and not affiliated with{" "}
            {c.name}; all trademarks belong to their respective owners.
          </p>
          <p>
            Outrival offers EU data storage, see our{" "}
            <Link href="/security">security overview</Link> for specifics.
          </p>
          <p>
            Sources:{" "}
            {c.sources.map((s, i) => (
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
