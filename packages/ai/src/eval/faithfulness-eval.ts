/* eslint-disable no-console */
//
// Labelled faithfulness eval — the ground-truth layer the unit tests deliberately
// lack. verify.test.ts stubs the judge, so it proves the WIRING (which claim gets
// judged, what the ratio becomes, what blocks); it says nothing about whether the
// real model tells a legitimate paraphrase from an invention. That is a model
// property and it is measured here, against hand-labelled pairs.
//
// Two gates, asymmetric on purpose:
//   1. inventions REJECTED   — the gate's reason to exist          (gate: 100%)
//   2. paraphrases ACCEPTED  — a false block silences a real alert (gate: >= 80%)
//
// Manual, NOT CI (live LLM calls): run before shipping any change to the judge
// prompt, the extractor prompt, or the pool's fast model.
//
//   set -a && . ./.env.local && set +a && pnpm --filter @outrival/ai eval:faithfulness

import { judgeClaim } from "../faithfulness/judge-claim";
import type { Claim } from "../faithfulness/types";

interface Case {
  label: string;
  claim: Claim;
  source: string;
  /** What a correct judge answers. */
  faithful: boolean;
}

const PRICING_SOURCE = `Plans
Starter — $49 per month, billed monthly. Up to 3 seats.
Growth — $199 per month, billed monthly. Up to 15 seats.
Enterprise — contact sales.
All plans include a 14-day free trial. No credit card required.`;

const REVIEWS_SOURCE = `Recent reviews for Acme Analytics (G2, 4.2/5 over 318 reviews)
Complaint: "The dashboard is slow once you pass a few million events."
Complaint: "Support takes days to reply on the Starter plan."
Praise: "Setup took us under an hour."`;

const BLOG_SOURCE = `Introducing Acme Warehouse Sync
Starting today, every Growth and Enterprise customer can stream events straight
into Snowflake and BigQuery. Sync runs every 15 minutes. Redshift is planned for
next quarter.`;

// Legitimate paraphrases: the fact IS in the source, worded differently — exactly
// the case the fuzzy validator cannot settle and a naive judge over-rejects.
const PARAPHRASES: Case[] = [
  {
    label: "restated price",
    claim: {
      text: "Acme's entry plan costs forty-nine dollars a month.",
      citedQuote: "the entry plan is forty-nine dollars monthly",
    },
    source: PRICING_SOURCE,
    faithful: true,
  },
  {
    label: "summarised trial",
    claim: {
      text: "Every plan comes with a two-week trial that needs no card.",
      citedQuote: "two-week free trial, no card needed",
    },
    source: PRICING_SOURCE,
    faithful: true,
  },
  {
    label: "two passages combined",
    claim: {
      text: "Warehouse sync reaches Snowflake and BigQuery on the paid tiers.",
      citedQuote: "Growth and Enterprise customers can stream into Snowflake and BigQuery",
    },
    source: BLOG_SOURCE,
    faithful: true,
  },
  {
    label: "generalised complaint",
    claim: {
      text: "Reviewers say performance degrades at high event volume.",
      citedQuote: "the dashboard is slow at high volume",
    },
    source: REVIEWS_SOURCE,
    faithful: true,
  },
  {
    label: "rating restated",
    claim: {
      text: "Acme holds a 4.2 rating on G2.",
      citedQuote: "G2, 4.2/5",
    },
    source: REVIEWS_SOURCE,
    faithful: true,
  },
];

// Inventions: plausible, on-topic, and absent from the source. Two of them are the
// failure mode battle cards actually produced in prod — a claim built on missing
// data, and a one-sided comparison.
const INVENTIONS: Case[] = [
  {
    label: "invented certification",
    claim: { text: "Acme Analytics has no SOC 2 certification.", citedQuote: "" },
    source: PRICING_SOURCE,
    faithful: false,
  },
  {
    label: "invented number",
    claim: {
      text: "Acme serves over 5,000 customers.",
      citedQuote: "trusted by more than 5,000 companies",
    },
    source: PRICING_SOURCE,
    faithful: false,
  },
  {
    label: "claim built on absent data",
    claim: {
      text: "Their pricing for large teams is not publicly available, unlike ours.",
      citedQuote: "Enterprise — contact sales",
    },
    source: PRICING_SOURCE,
    faithful: false,
  },
  {
    label: "unsupported one-sided comparison",
    claim: {
      text: "We sync to warehouses faster than Acme does.",
      citedQuote: "Sync runs every 15 minutes",
    },
    source: BLOG_SOURCE,
    faithful: false,
  },
  {
    label: "wrong tier attribution",
    claim: {
      text: "Starter customers get Snowflake sync.",
      citedQuote: "every customer can stream into Snowflake",
    },
    source: BLOG_SOURCE,
    faithful: false,
  },
  {
    label: "invented roadmap date",
    claim: {
      text: "Redshift support ships in March.",
      citedQuote: "Redshift arrives in March",
    },
    source: BLOG_SOURCE,
    faithful: false,
  },
];

async function run(cases: Case[]): Promise<{ correct: number; misses: string[] }> {
  let correct = 0;
  const misses: string[] = [];
  for (const c of cases) {
    const verdict = await judgeClaim(c.claim, c.source);
    if (!verdict) {
      misses.push(`${c.label}: NO VERDICT (parse miss / provider error)`);
      continue;
    }
    if (verdict.faithful === c.faithful) {
      correct++;
      console.log(`  ok    ${c.label}`);
    } else {
      misses.push(`${c.label}: said ${verdict.faithful} — "${verdict.reason}"`);
      console.log(`  MISS  ${c.label} — ${verdict.reason}`);
    }
  }
  return { correct, misses };
}

async function main(): Promise<void> {
  console.log("\nInventions (must be REJECTED):");
  const inv = await run(INVENTIONS);
  console.log("\nParaphrases (must be ACCEPTED):");
  const par = await run(PARAPHRASES);

  const invRate = inv.correct / INVENTIONS.length;
  const parRate = par.correct / PARAPHRASES.length;

  console.log("\n--- faithfulness judge ---");
  console.log(`inventions rejected : ${inv.correct}/${INVENTIONS.length} (${(invRate * 100).toFixed(0)}%)  gate 100%`);
  console.log(`paraphrases kept    : ${par.correct}/${PARAPHRASES.length} (${(parRate * 100).toFixed(0)}%)  gate >= 80%`);
  for (const m of [...inv.misses, ...par.misses]) console.log(`  · ${m}`);

  const failed = invRate < 1 || parRate < 0.8;
  console.log(failed ? "\nFAILED\n" : "\nPASSED\n");
  process.exit(failed ? 1 : 0);
}

void main();
