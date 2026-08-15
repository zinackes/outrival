import type { CSSProperties, ReactElement } from "react";
import { MagnifyingGlassIcon } from "@/components/icons";
import { SilkFill } from "./silk-fill";

// "This is the product" = the surfaces, six screens you actually open. The
// mechanism behind them is the Pipeline section right below, so nothing here
// re-explains scanning, filtering or writing: this section is what the software
// looks like, that one is what it does.
//
// One anchor and five supports. The signal is the anchor because it is the
// atomic object of the product: a diff you can check. The five others each hold
// ONE idea, cropped to the smallest object that still reads as itself.
//
// Every card carries a Silk fill, like the pipeline steps and the plans: it is
// the material the dark body is made of, and a flat plate here made this
// section the one hole in the page. The tint is per card and stays under the
// content — the fragments still run edge to edge, so nothing floats on it.
//
// Hand-built DOM, never a raster: a screenshot carries none of the page's own
// type and goes stale the day the product moves. Each one is aria-hidden — the
// title carries the meaning, so a screen reader gets the point instead of
// walking a pile of decorative UI.

const BOARD = [
  { name: "Vantage", move: "Cut Pro to $49, no seat minimum", ago: "2h", sev: "var(--critical)" },
  { name: "Meridian", move: "Moved to usage-based billing", ago: "4h", sev: "var(--high)" },
  { name: "Beacon", move: "Hired three enterprise AEs", ago: "1d", sev: "var(--medium)" },
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

// The anchor. The diff is the whole object: a competitive claim you can check,
// not a sentence asserting that something changed. Critical is the only color
// on the card, and it lands on the mark and on the new price.
function SignalCard() {
  return (
    <div className="pb-sig">
      <div className="pb-sig-top">
        <span className="pb-sev">Critical</span>
        <span className="pb-cat">pricing</span>
        <em>2h ago</em>
      </div>
      <div className="pb-diff">
        <div className="was">$69/user/mo</div>
        <div className="now">$49/user/mo</div>
        <div className="sub">5-seat minimum &rarr; no minimum</div>
      </div>
      <p className="pb-sig-so">
        <b>So what</b> Undercuts your Pro tier on the mid-market deals you are
        closing now.
      </p>
    </div>
  );
}

// The board: who moved, what they did, how long ago. The severity lives in the
// mark, so the eye ranks the list before it reads a word of it. Three rows, not
// six: the shape of the object is the point, the length of it is not.
function MarketBoard() {
  return (
    <div className="pb-board">
      {BOARD.map((row) => (
        <div key={row.name} className="pb-brow">
          <i className="mark" style={{ "--c": row.sev } as CSSProperties}>
            {row.name.slice(0, 1)}
          </i>
          <b>{row.name}</b>
          <em>{row.ago}</em>
          <span>{row.move}</span>
        </div>
      ))}
    </div>
  );
}

// One card, not a deck: the promise is that the section rewrote itself while you
// were not looking, and a single sheet says that in one read.
function BattleCard() {
  return (
    <div className="pb-bc">
      <i>Vantage · Pricing</i>
      <p>
        Pro <b>$49/mo</b>, was <s>$69</s>. Seat minimum dropped.
      </p>
      <em>Rewritten 2h ago</em>
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

// The anchor is the only cell that keeps a sentence under its title. The five
// others hold an object that says the same thing faster than a line of text
// would, so the line is gone.
// `tint` is the Silk colour, a literal hex (the shader cannot read a var).
// Each one is the card's subject desaturated into the plate: pricing red on the
// signal, teal on the board, ink blue on the ask, amber on the battle card.
type Cell = {
  key: string;
  title: string;
  tint: string;
  text?: string;
  Viz: () => ReactElement;
};

const CARDS: Cell[] = [
  {
    key: "signal",
    title: "What changed, why it matters, what to do.",
    text: "Every signal carries the diff it came from and the read on it.",
    tint: "#2e2024",
    Viz: SignalCard,
  },
  {
    key: "overview",
    title: "Every competitor, ranked by what moved.",
    tint: "#1f2a29",
    Viz: MarketBoard,
  },
  {
    key: "ask",
    title: "Ask your market a question.",
    tint: "#1e2533",
    Viz: AskScreen,
  },
  {
    key: "battle",
    title: "Battle cards that rewrite themselves.",
    tint: "#302921",
    Viz: BattleCard,
  },
  {
    key: "aiv",
    title: "See where you stand in AI answers.",
    tint: "#262533",
    Viz: RankLadder,
  },
  {
    key: "recap",
    title: "Your quarter, at a glance.",
    tint: "#202a29",
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
            {card.text ? <p>{card.text}</p> : null}
          </div>
          <div className="pb-viz" aria-hidden="true">
            <card.Viz />
          </div>
        </article>
      ))}
    </div>
  );
}
