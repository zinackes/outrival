import type { CSSProperties } from "react";
import { MagnifyingGlassIcon } from "@/components/icons";

// "This is the product" = the surfaces, six screens you actually open. The
// mechanism behind them is the Pipeline section right below, so nothing here
// re-explains scanning, filtering or writing: this section is what the software
// looks like, that one is what it does.
//
// Every screen is hand-built DOM, never a raster: a screenshot carries none of
// the page's own type and goes stale the day the product moves. They are
// aria-hidden — the title and the sentence above each one carry the meaning, so
// a screen reader gets the point instead of walking a pile of fake UI.
//
// Shape borrowed from the references: asymmetric grid, text at the top, and the
// visual bleeding off the bottom edge under a mask instead of floating in the
// middle of an empty cell.

const OVERVIEW_ROWS = [
  { name: "Meridian", n: 9, ago: "2h", act: "100%", sev: "var(--critical)" },
  { name: "Vantage", n: 7, ago: "4h", act: "78%", sev: "var(--high)" },
  { name: "Beacon", n: 4, ago: "1d", act: "44%", sev: "var(--high)" },
  { name: "Lumen", n: 3, ago: "1d", act: "31%", sev: "var(--medium)" },
  { name: "Cobalt", n: 2, ago: "2d", act: "12%", sev: "var(--low)" },
  { name: "Nimbus", n: 1, ago: "3d", act: "9%", sev: "var(--low)" },
  { name: "Halo", n: 1, ago: "5d", act: "6%", sev: "var(--low)" },
  { name: "Orion", n: 1, ago: "6d", act: "5%", sev: "var(--low)" },
  { name: "Pallas", n: 1, ago: "1w", act: "4%", sev: "var(--low)" },
  { name: "Quilt", n: 1, ago: "2w", act: "3%", sev: "var(--low)" },
  { name: "Verge", n: 1, ago: "3w", act: "2%", sev: "var(--low)" },
  { name: "Solace", n: 1, ago: "3w", act: "2%", sev: "var(--low)" },
  { name: "Tessera", n: 1, ago: "4w", act: "1%", sev: "var(--low)" },
];

const MODEL_SHARE = [
  { name: "Meridian", pct: 61 },
  { name: "Vantage", pct: 45 },
  { name: "You", pct: 34, self: true },
  { name: "Beacon", pct: 12 },
];

// Chrome bar. A panel that opens straight on its content reads as a slide; the
// name, the path and the outlined state pill are what make it read as a screen.
function Chrome({
  owner,
  path,
  pill,
  pillColor,
}: {
  owner: string;
  path: string;
  pill: string;
  pillColor: string;
}) {
  return (
    <div className="lp-chrome">
      {owner === "Outrival" ? (
        <b>
          Out<i>rival</i>
        </b>
      ) : (
        <b>{owner}</b>
      )}
      <span className="path">{path}</span>
      <span className="lp-pill has-dot" style={{ "--pill": pillColor } as CSSProperties}>
        {pill}
      </span>
    </div>
  );
}

function OverviewScreen() {
  return (
    <div className="lp-view lp-overview">
      <Chrome
        owner="Outrival"
        path="/ overview"
        pill="Live"
        pillColor="var(--lp-teal)"
      />
      <div className="ov-tools">
        <span className="ov-search">
          <MagnifyingGlassIcon size={14} />
          Search competitors
        </span>
        <span className="ov-seg">
          <i className="on">7 days</i>
          <i>30 days</i>
          <i>All</i>
        </span>
      </div>
      <div className="ov-head">
        <span>Competitor</span>
        <span>Activity</span>
        <span>Signals</span>
        <span>Last</span>
      </div>
      {OVERVIEW_ROWS.map((row) => (
        <div key={row.name} className="ov-row">
          <span className="ov-name">
            <i className="av">{row.name.slice(0, 1)}</i>
            {row.name}
          </span>
          <span className="ov-act">
            <i style={{ width: row.act, background: row.sev }} />
          </span>
          <span className="ov-n">{row.n}</span>
          <span className="ov-t">{row.ago}</span>
        </div>
      ))}
    </div>
  );
}

function SignalScreen() {
  return (
    <div className="lp-view lp-sigdet">
      <Chrome
        owner="Vantage"
        path="/ signals / pricing"
        pill="Critical"
        pillColor="var(--critical)"
      />
      <div className="sd-body">
        <div className="sd-meta">
          <span
            className="lp-chip-cat-c"
            style={{ "--c": "var(--cat-pricing)" } as CSSProperties}
          >
            pricing
          </span>
          <span className="sd-time">2h ago · pricing page</span>
        </div>
        <p className="sd-title">Pro plan cut 30% to $49/mo, seat minimum dropped.</p>
        <div className="sd-sec">
          <span className="sd-lbl">What changed</span>
          {/* The diff in a bordered sub-panel: a nested frame is what separates
              a product screen from a paragraph in a box. */}
          <div className="sd-diff">
            <div className="sd-was">Pro · $69/user/mo · 5-seat minimum</div>
            <div className="sd-now">Pro · $49/user/mo · no seat minimum</div>
          </div>
        </div>
        <div className="sd-sec">
          <span className="sd-lbl">So what</span>
          <p>
            Undercuts your $69 Pro tier on the mid-market deals you&rsquo;re closing
            now.
          </p>
        </div>
        <div className="sd-sec">
          <span className="sd-lbl">Action</span>
          <p>Brief sales on the gap today; weigh a value-add bundle before renewals.</p>
        </div>
      </div>
    </div>
  );
}

// A deck rather than a single sheet: the point of a battle card is that there
// is one per competitor and they keep themselves current.
function BattleDeck() {
  return (
    <div className="pb-deck">
      <div className="pb-sheet s3" />
      <div className="pb-sheet s2" />
      <div className="pb-sheet s1">
        <div className="pb-sheet-top">
          <b>Vantage</b>
          <span>Battle card · 6 sections</span>
        </div>
        <div className="pb-bc live">
          <i>Pricing</i>
          <p>
            Pro <b>$49/mo</b>, was $69. Seat minimum dropped.
          </p>
          <em>Rewritten 2h ago</em>
        </div>
        <div className="pb-bc">
          <i>Objections</i>
          <p>&ldquo;They&rsquo;re cheaper.&rdquo; Counter with the migration cost.</p>
          <em>From 4 won deals</em>
        </div>
      </div>
    </div>
  );
}

function AskScreen() {
  return (
    <div className="pb-ask">
      <div className="pb-ask-bar">
        <MagnifyingGlassIcon size={14} />
        Who moved on pricing this quarter?
        <i className="pb-caret" />
      </div>
      <p className="pb-ask-ans">
        Three of seven. <b>Vantage</b> cut Pro 30%, <b>Meridian</b> moved to
        usage-based billing, <b>Cobalt</b> added a free tier in June.
      </p>
      <div className="pb-cites">
        <span>vantage.com/pricing</span>
        <span>meridian.io/changelog</span>
        <span>+4</span>
      </div>
    </div>
  );
}

function ShareOfModel() {
  return (
    <>
      <div className="pb-bars">
        {MODEL_SHARE.map((row) => (
          <div key={row.name} className={row.self ? "pb-bar is-self" : "pb-bar"}>
            <i>{row.name}</i>
            <span>
              <b style={{ width: `${row.pct}%` }} />
            </span>
            <em>{row.pct}%</em>
          </div>
        ))}
      </div>
      <p className="pb-note">
        24 buying-intent prompts, asked weekly to ChatGPT, Claude and Perplexity.
      </p>
    </>
  );
}

function RecapSlides() {
  return (
    <div className="pb-slides">
      <div className="pb-slide s3" />
      <div className="pb-slide s2" />
      <div className="pb-slide s1">
        <span>Q2 recap</span>
        <b>127</b>
        <i>competitor moves tracked, 9 you acted on</i>
      </div>
    </div>
  );
}

const CARDS = [
  {
    key: "overview",
    title: "Every competitor, ranked by what actually moved.",
    text: "One table for the whole market, sorted by who moved this week rather than by who you added first.",
    Viz: OverviewScreen,
  },
  {
    key: "signal",
    title: "What changed, why it matters, what to do.",
    text: "Each signal carries the diff it came from, the read on it, and one action.",
    Viz: SignalScreen,
  },
  {
    key: "battle",
    title: "Battle cards that rewrite themselves.",
    text: "One per competitor. A fresh pricing signal rewrites the pricing section and dates it.",
    Viz: BattleDeck,
  },
  {
    key: "ask",
    title: "Ask your market a question.",
    text: "Plain English in, an answer out, cited back to the pages it came from.",
    Viz: AskScreen,
  },
  {
    key: "aiv",
    title: "See where you stand in AI answers.",
    text: "Share of model: how often you come up when buyers ask, next to who outranks you.",
    Viz: ShareOfModel,
  },
  {
    key: "recap",
    title: "Your quarter, in one recap.",
    text: "A monthly deck of what moved, what you acted on, and what you let pass.",
    Viz: RecapSlides,
  },
];

export function ProductBento() {
  return (
    <div className="pb-grid">
      {CARDS.map((card) => (
        <article key={card.key} className={`pb-card pb-${card.key}`}>
          <div className="pb-head">
            <h3>{card.title}</h3>
            <p>{card.text}</p>
          </div>
          <div className="pb-viz" aria-hidden="true">
            <card.Viz />
          </div>
        </article>
      ))}
    </div>
  );
}
