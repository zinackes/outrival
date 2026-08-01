import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Breadcrumbs, CompareShell } from "./compare/compare-shell";
import { CompareFaq } from "./compare/compare-faq";
import { Pricing } from "./pricing";
import { COMPETITORS, LAST_REVIEWED, PRICE_AS_OF } from "./compare/data";

// A dedicated /pricing URL. Pricing lived only as an anchor on the landing
// (`/#pricing`), so the single highest-intent query in this category — what a
// competitive-intelligence tool costs — had no page of its own to rank, and an
// answer engine asked the same question had no document to cite. The plan cards
// are the same <Pricing /> component the landing renders, so the two can never
// quote different numbers.
//
// The market-context block below is the part that earns the page: every rival in
// this category hides its price behind a demo, which means "how much does
// competitive intelligence software cost" is a question the web answers badly.
// Answering it with dated, attributed third-party figures is both the honest
// answer and the reason to link here.

const CONTEXT_ROWS = [
  {
    name: "Outrival",
    self: true,
    price: "€0 to €199 / month",
    yearly: "€0 to €2,388 / year",
    access: "Self-serve, published price",
    commitment: "Monthly, cancel in one click",
  },
  {
    name: COMPETITORS.crayon.name,
    price: COMPETITORS.crayon.pricing.headline,
    yearly: COMPETITORS.crayon.pricing.estimate,
    access: "Demo required, custom quote",
    commitment: "Annual contract",
  },
  {
    name: COMPETITORS.klue.name,
    price: COMPETITORS.klue.pricing.headline,
    yearly: COMPETITORS.klue.pricing.estimate,
    access: "Demo required, custom quote",
    commitment: "Annual contract",
  },
];

const PRICING_FAQS = [
  {
    q: "How much does competitive intelligence software cost?",
    a: `It splits in two. The enterprise suites are sales-led and quote-based: Vendr reports a median of about $29,500 per year for Crayon across 92 purchases (range $12,600 to $46,500, page last updated February 2026), and third-party marketplaces place typical Klue deals at $20,000 to $40,000 per year. Self-serve tools sit two orders of magnitude below that. Outrival publishes its list: free on 2 competitors, then €29, €79 or €199 per month, billed monthly. Figures checked ${PRICE_AS_OF}.`,
  },
  {
    q: "Is there a free plan?",
    a: "Yes, and it does not expire. The Free plan monitors 2 competitors on homepage, pricing and blog, and sends the weekly digest. No credit card, no call, no trial clock. It exists so you can judge the signal quality on your own market before paying for anything.",
  },
  {
    q: "What am I actually paying for as the price goes up?",
    a: "Two things: how many competitors you track, and how fast you hear about a change. Free covers 2 competitors on a weekly scan. Starter (€29) covers 5 with daily scans and Slack delivery. Pro (€79) covers 15 with real-time alerts, AI battle cards and outbound webhooks. Business (€199) covers 50 with the highest re-scan and discovery limits. Each plan contains the one below it.",
  },
  {
    q: "Is there usage-based billing on top?",
    a: "No. Every AI cost is included in the plan price. There is no per-scan, per-token or per-insight meter, so the invoice is the same number every month regardless of how much your competitors move.",
  },
  {
    q: "Do you charge per seat?",
    a: "The price covers the workspace and the competitor count. Multi-user workspaces are a Business-plan feature; if you need SSO or a custom DPA, email hello@outrival.app and it gets handled directly by the founder.",
  },
  {
    q: "Is it monthly or annual?",
    a: "Monthly. There is no annual commitment to sign and no minimum term, and you cancel from the dashboard in one click, keeping access until the end of the cycle you already paid for. That is deliberate: in this category the standard is a year-long contract signed before you have seen a single insight.",
  },
  {
    q: "What is not included at any price?",
    a: "A public API (the /docs page says plainly that there are no endpoints or keys yet), win-loss interview modules, and distributed battlecard adoption analytics for a large sales org. If those are the job, Klue and Crayon are built for it and this site says so on its comparison pages.",
  },
];

function ContextTable() {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[46rem] border-collapse text-sm">
        <caption className="sr-only">
          What competitive intelligence tools cost, compared
        </caption>
        <thead>
          <tr className="border-b border-border-strong text-left">
            <th scope="col" className="py-3 pr-4 font-medium">
              Tool
            </th>
            <th scope="col" className="py-3 pr-4 font-medium">
              Published price
            </th>
            <th scope="col" className="py-3 pr-4 font-medium">
              Typical annual cost
            </th>
            <th scope="col" className="py-3 pr-4 font-medium">
              How you buy
            </th>
            <th scope="col" className="py-3 font-medium">
              Commitment
            </th>
          </tr>
        </thead>
        <tbody>
          {CONTEXT_ROWS.map((row) => (
            <tr
              key={row.name}
              className={`border-b border-border align-top ${
                row.self ? "bg-surface" : ""
              }`}
            >
              <th
                scope="row"
                className={`py-4 pr-4 text-left font-medium ${
                  row.self ? "text-primary" : ""
                }`}
              >
                {row.name}
              </th>
              <td className="py-4 pr-4 text-text-muted">{row.price}</td>
              <td className="py-4 pr-4 tabular-nums text-text-muted">
                {row.yearly}
              </td>
              <td className="py-4 pr-4 text-text-muted">{row.access}</td>
              <td className="py-4 text-text-muted">{row.commitment}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function PricingPage() {
  return (
    <CompareShell>
      <section className="mx-auto w-full max-w-6xl px-6 pb-10 pt-10 sm:pt-12">
        <Breadcrumbs
          items={[
            { name: "Home", path: "/" },
            { name: "Pricing", path: "/pricing" },
          ]}
        />
        <h1 className="mt-8 max-w-3xl text-[clamp(2.4rem,5vw,3.6rem)] font-semibold leading-[1.05] tracking-[-0.02em] text-balance">
          Competitive intelligence, priced in public
        </h1>
        <p className="mt-6 max-w-2xl text-lead leading-relaxed text-text-muted text-pretty">
          Free forever on 2 competitors, then €29, €79 or €199 a month. Every AI
          cost is included, billing is monthly, and cancelling takes one click.
          No demo stands between you and the price.
        </p>
      </section>

      <Pricing />

      <section className="mx-auto w-full max-w-6xl px-6 py-16 sm:py-20">
        <div className="max-w-2xl">
          <h2 className="text-2xl font-semibold leading-tight tracking-tight sm:text-3xl">
            What this category normally costs
          </h2>
          <p className="mt-4 leading-relaxed text-text-muted text-pretty">
            The established competitive-intelligence platforms are sales-led and
            publish no list price, so the only figures available are dated
            third-party estimates. They are reproduced here as they are
            published, with their source, because a buyer comparing options
            deserves the number before the call rather than after it.
          </p>
        </div>
        <div className="mt-10">
          <ContextTable />
        </div>
        <p className="mt-6 text-dense text-text-subtle">
          Competitor figures are third-party estimates, not list prices, and are
          attributed on{" "}
          <Link href="/vs/crayon" className="text-primary hover:underline">
            Outrival vs Crayon
          </Link>{" "}
          and{" "}
          <Link href="/vs/klue" className="text-primary hover:underline">
            Outrival vs Klue
          </Link>
          . Last reviewed {LAST_REVIEWED}.
        </p>
      </section>

      <div className="border-t border-border bg-background-2">
        <CompareFaq heading="Pricing questions" faqs={PRICING_FAQS} />
      </div>

      <section className="mx-auto w-full max-w-6xl px-6 py-16 sm:py-20">
        <div className="rounded-xl border border-border bg-surface p-8 sm:p-10">
          <h2 className="text-2xl font-semibold leading-tight tracking-tight">
            See the output before you pay for it
          </h2>
          <p className="mt-4 max-w-2xl leading-relaxed text-text-muted text-pretty">
            A real generated weekly digest is published on this site, readable
            without an account. Judge the signal quality on that, then start on
            the free plan.
          </p>
          <div className="mt-7 flex flex-wrap items-center gap-3">
            <Button asChild size="lg">
              <Link href="/auth">Start free</Link>
            </Button>
            <Button asChild size="lg" variant="outline">
              <Link href="/sample">Read a real digest</Link>
            </Button>
          </div>
        </div>
      </section>
    </CompareShell>
  );
}
