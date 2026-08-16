import Link from "next/link";
import { Band, CompareShell, PageHero } from "./compare/compare-shell";
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

type ContextCol = {
  name: string;
  /** Ours: the one column that gets colour. */
  self?: boolean;
  price: string;
  yearly: string;
  access: string;
  commitment: string;
};

const CONTEXT_COLS: ContextCol[] = [
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

const CONTEXT_ATTRS: {
  label: string;
  key: keyof Omit<ContextCol, "name" | "self">;
}[] = [
  { label: "Published price", key: "price" },
  { label: "Typical annual cost", key: "yearly" },
  { label: "How you buy", key: "access" },
  { label: "Commitment", key: "commitment" },
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

// The market context, transposed. It first shipped as five columns of dense
// hairline rows — the shape of a spec sheet, which is exactly what the plan
// cards two blocks up are not, and five columns forced a 46rem scroll on a
// page whose whole point is that the number is easy to find. One column per
// tool instead: three columns, four attributes down the side, and ours drawn
// as a filled column with the featured plan card's iris outline so the eye
// lands on it first. The label column sticks while the rest scrolls on a
// phone, so a value never loses its row.
function ContextTable() {
  return (
    <div className="lp-ctx-wrap">
      <table className="lp-ctx">
        <caption className="sr-only">
          What competitive intelligence tools cost, compared
        </caption>
        <thead>
          <tr>
            <td className="ctx-corner" />
            {CONTEXT_COLS.map((col) => (
              <th
                key={col.name}
                scope="col"
                className={col.self ? "is-self" : undefined}
              >
                {col.name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {CONTEXT_ATTRS.map((attr) => (
            <tr key={attr.key}>
              <th scope="row">{attr.label}</th>
              {CONTEXT_COLS.map((col) => (
                <td key={col.name} className={col.self ? "is-self" : undefined}>
                  {col[attr.key]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// The page runs the landing's rhythm: paper opening, one graphite body holding
// the whole price argument (our plans, then what the category charges), paper
// again for the questions and the close, dark footer. The plan cards are the
// landing's own <Pricing />, which is why they can never quote a different
// number — and why they finally sit on the dark they were drawn for.
export function PricingPage() {
  return (
    <CompareShell>
      <PageHero
        crumbs={[
          { name: "Home", path: "/" },
          { name: "Pricing", path: "/pricing" },
        ]}
      >
        <h1>
          Competitive intelligence, priced{" "}
          <span className="lp-serif-accent">in public</span>.
        </h1>
        <p className="lp-page-lead">
          Free forever on 2 competitors, then €29, €79 or €199 a month. Every AI
          cost is included, billing is monthly, and cancelling takes one click.
          No demo stands between you and the price.
        </p>
        <div className="lp-page-ctas">
          <a className="lp-btn-accent lp-btn-hero" href="/auth">
            Start free
          </a>
          <Link href="/sample" className="lp-link-sample">
            Read a real digest
          </Link>
        </div>
      </PageHero>

      <section className="lp-band-dark dark" data-lp-tone="dark">
        <Pricing />
        <div className="lp-inner">
          <div className="lp-head">
            <h2>
              What this category normally{" "}
              <span className="lp-serif-accent">costs</span>.
            </h2>
            <p>
              Every established platform here is sales-led and publishes no list
              price, so the only figures that exist are dated third-party
              estimates. They are reproduced as published, with their source.
            </p>
          </div>
          <ContextTable />
          <p className="mt-6 text-dense text-text-subtle">
            Competitor figures are third-party estimates, not list prices, and
            are attributed on{" "}
            <Link href="/vs/crayon" className="text-primary hover:underline">
              Outrival vs Crayon
            </Link>{" "}
            and{" "}
            <Link href="/vs/klue" className="text-primary hover:underline">
              Outrival vs Klue
            </Link>
            . Last reviewed {LAST_REVIEWED}.
          </p>
        </div>
      </section>

      <Band tone="paper">
        <CompareFaq
          heading={
            <>
              Questions about the{" "}
              <span className="lp-serif-accent">price</span>.
            </>
          }
          faqs={PRICING_FAQS}
        />
        {/* Closing ask in the landing's register: one statement, one button,
            and the offer that answers the objection the price raises — judge
            the output before paying for it. */}
        <div className="lp-final">
          <h2>
            See the output before you{" "}
            <span className="lp-serif-accent">pay</span> for it.
          </h2>
          <p className="sub-f">
            A real generated weekly digest is published on this site, readable
            without an account. Judge the signal quality on that, then start on
            the free plan.
          </p>
          <a className="lp-btn-accent" href="/auth">
            Start free
          </a>
          <p className="lp-final-micro">
            No credit card · cancel in one click ·{" "}
            <Link href="/sample">read a real digest</Link>
          </p>
        </div>
      </Band>
    </CompareShell>
  );
}
