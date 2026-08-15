import type { CSSProperties } from "react";
import { MagnifyingGlassIcon } from "@/components/icons";
import { SilkFill } from "./silk-fill";

// "This is the product" = the surfaces, six screens you actually open. The
// mechanism behind them is the Pipeline section right below, so nothing here
// re-explains scanning, filtering or writing: this section is what the software
// looks like, that one is what it does.
//
// Every cell holds an OBJECT lifted out of a screen, never a fake window: no
// chrome bar, no traffic lights, no breadcrumb path. A miniature browser frame
// is the fastest way to make six cards look like the same stock template, and
// the path never says anything the sentence above the card has not already
// said. What is left is the one shape that only this product makes: a market
// board, a diff, a deck, a prompt, a rank ladder, a quarter of weeks.
//
// Hand-built DOM, never a raster: a screenshot carries none of the page's own
// type and goes stale the day the product moves. Each one is aria-hidden — the
// title and the sentence carry the meaning, so a screen reader gets the point
// instead of walking a pile of decorative UI.

const BOARD = [
  { name: "Vantage", move: "Cut Pro to $49, no seat minimum", n: 9, ago: "2h", sev: "var(--critical)" },
  { name: "Meridian", move: "Moved to usage-based billing", n: 7, ago: "4h", sev: "var(--high)" },
  { name: "Beacon", move: "Hired three enterprise AEs", n: 4, ago: "1d", sev: "var(--high)" },
  { name: "Lumen", move: "Shipped an SSO tier", n: 3, ago: "1d", sev: "var(--medium)" },
  { name: "Cobalt", move: "Retired the free plan", n: 2, ago: "2d", sev: "var(--low)" },
  { name: "Nimbus", move: "Rewrote the homepage", n: 1, ago: "3d", sev: "var(--low)" },
];

const LADDER = [
  { rank: 1, name: "Meridian", pct: 61 },
  { rank: 2, name: "Vantage", pct: 45 },
  { rank: 3, name: "You", pct: 34, self: true },
  { rank: 4, name: "Beacon", pct: 12 },
];

// One string per week, one character per weekday: 0 quiet, 1 to 4 the severity
// of what landed that day. Written out rather than generated so the quarter has
// a shape — a heavy week in May, a critical day in June.
const QUARTER = [
  "00100", "01000", "00200", "10000", "00010", "02001", "00100",
  "30000", "01000", "00201", "10000", "00040", "01003",
];
const HEAT: Record<string, string> = {
  "1": "var(--low)",
  "2": "var(--medium)",
  "3": "var(--high)",
  "4": "var(--critical)",
};

// The board: who moved, what they did, how long ago. The severity lives in the
// mark, so the eye ranks the list before it reads a word of it.
function MarketBoard() {
  return (
    <div className="pb-board">
      {BOARD.map((row) => (
        <div key={row.name} className="pb-brow">
          <i className="mark" style={{ "--c": row.sev } as CSSProperties}>
            {row.name.slice(0, 1)}
          </i>
          <b>{row.name}</b>
          <span>{row.move}</span>
          <u>{row.n}</u>
          <em>{row.ago}</em>
        </div>
      ))}
    </div>
  );
}

// One signal, opened. The diff is the whole point: a competitive claim you can
// check, not a sentence asserting that something changed.
function SignalCard() {
  return (
    <div className="pb-sig">
      <div className="pb-sig-top">
        <span className="pb-sev">Critical</span>
        <span className="pb-cat">pricing</span>
        <em>2h ago</em>
      </div>
      <p className="pb-sig-title">
        Vantage cut Pro to $49/mo and dropped the seat minimum.
      </p>
      <div className="pb-diff">
        <div className="was">$69/user/mo · 5-seat minimum</div>
        <div className="now">$49/user/mo · no minimum</div>
      </div>
      <p className="pb-sig-so">
        <b>So what</b> Undercuts your Pro tier on the mid-market deals you are
        closing now.
      </p>
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
        <div className="pb-bc live">
          <i>Vantage · Pricing</i>
          <p>
            Pro <b>$49/mo</b>, was $69. Seat minimum dropped.
          </p>
          <em>Rewritten 2h ago</em>
        </div>
        <div className="pb-bc">
          <i>Vantage · Objections</i>
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
      <div className="pb-ask-ans">
        <p>Three of seven, in the last 90 days.</p>
        <ul>
          <li>
            <b>Vantage</b> cut Pro 30% to $49/mo
          </li>
          <li>
            <b>Meridian</b> moved to usage-based billing
          </li>
          <li>
            <b>Cobalt</b> added a free tier in June
          </li>
        </ul>
      </div>
      <div className="pb-cites">
        <span>vantage.com/pricing</span>
        <span>meridian.io/changelog</span>
        <span>+4</span>
      </div>
    </div>
  );
}

// A ladder, not a bar chart: the number people want is their rank, and the
// percentage is the evidence for it.
function RankLadder() {
  return (
    <>
      <div className="pb-ladder">
        <span className="pb-lq">&ldquo;Best competitive intelligence tool&rdquo;</span>
        {LADDER.map((row) => (
          <div key={row.name} className={row.self ? "pb-lrow is-self" : "pb-lrow"}>
            <u>{row.rank}</u>
            <b>{row.name}</b>
            <em>{row.pct}%</em>
            <i style={{ width: `${row.pct}%` }} />
          </div>
        ))}
      </div>
      <p className="pb-note">
        Share of answer across 24 buying-intent prompts, asked weekly.
      </p>
    </>
  );
}

// The quarter as one object: thirteen weeks of weekdays, lit by what landed.
function QuarterHeat() {
  return (
    <div className="pb-quarter">
      <div className="pb-qstat">
        <b>127</b>
        <span>moves tracked in Q2, 9 you acted on</span>
      </div>
      <div className="pb-weeks">
        {QUARTER.map((week, w) => (
          <div key={week + String(w)} className="pb-week">
            {week.split("").map((day, d) => (
              <i
                key={`${w}-${d}`}
                style={{ background: HEAT[day] ?? "rgba(255, 255, 255, 0.07)" }}
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

// Silk needs a literal hex. One tint per card, taken from the same family the
// Pipeline steps use, so the two sections read as one page.
const CARDS = [
  {
    key: "overview",
    tint: "#1f2a29",
    title: "Every competitor, ranked by what actually moved.",
    text: "One board for the whole market, ordered by who moved this week rather than by who you added first.",
    Viz: MarketBoard,
  },
  {
    key: "signal",
    tint: "#2e2024",
    title: "What changed, why it matters, what to do.",
    text: "Each signal carries the diff it came from and the read on it.",
    Viz: SignalCard,
  },
  {
    key: "ask",
    tint: "#1e2533",
    title: "Ask your market a question.",
    text: "Plain English in, an answer out, cited back to the pages it came from.",
    Viz: AskScreen,
  },
  {
    key: "battle",
    tint: "#302921",
    title: "Battle cards that rewrite themselves.",
    text: "One per competitor. A fresh pricing signal rewrites the pricing section and dates it.",
    Viz: BattleDeck,
  },
  {
    key: "aiv",
    tint: "#262533",
    title: "See where you stand in AI answers.",
    text: "How often you come up when buyers ask, next to whoever outranks you.",
    Viz: RankLadder,
  },
  {
    key: "recap",
    tint: "#202a29",
    title: "Your quarter, at a glance.",
    text: "Every week of the quarter, colored by what moved and what you acted on.",
    Viz: QuarterHeat,
  },
];

export function ProductBento() {
  return (
    <div className="pb-grid">
      {CARDS.map((card) => (
        <article key={card.key} className={`pb-card pb-${card.key}`}>
          <SilkFill color={card.tint} />
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
