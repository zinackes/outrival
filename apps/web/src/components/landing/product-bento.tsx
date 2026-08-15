import type { CSSProperties, ReactElement } from "react";
import { MagnifyingGlassIcon } from "@/components/icons";
import {
  SigilAiv,
  SigilAsk,
  SigilBattle,
  SigilOverview,
  SigilRecap,
  SigilSignal,
} from "./bento-sigils";
import { SilkFill } from "./silk-fill";

// "This is the product" = the surfaces, six screens you actually open. The
// mechanism behind them is the Pipeline section right below, so nothing here
// re-explains scanning, filtering or writing: this section is what the software
// looks like, that one is what it does.
//
// The card is the object first and the sentence second. One short title with
// its mark inline, then the thing itself, filling everything under it — no
// sub-line, no note, no caption. A card that has to be read before it is
// understood has already lost the two seconds it gets.
//
// One anchor and five supports. The signal is the anchor because it is the
// atomic object of the product: a price that was, a price that is, and what it
// costs you. Every card carries a Silk fill, like the pipeline steps and the
// plans — it is the material the dark body is made of.
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

// The anchor. Two panes, the price that was and the price that is, each filling
// half the card: the change is the picture, not a sentence about a change. The
// severity strip above says how bad, the line below says what it costs you.
function SignalCard() {
  return (
    <div className="pb-sig">
      <div className="pb-sig-top">
        <span className="pb-sev">Critical</span>
        <span className="pb-cat">pricing</span>
        <em>2h ago</em>
      </div>
      <div className="pb-diff">
        <div className="pb-pane">
          <i>Before</i>
          <span>
            <b>$69</b>
            <em>per user / mo</em>
          </span>
          <u>5-seat minimum</u>
        </div>
        <div className="pb-pane is-now">
          <i>After</i>
          <span>
            <b>
              $49<mark>-29%</mark>
            </b>
            <em>per user / mo</em>
          </span>
          <u>No minimum</u>
        </div>
      </div>
      <p className="pb-sig-so">
        <b>So what</b> Undercuts your Pro tier on the deals you are closing now.
      </p>
    </div>
  );
}

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
        Who moved on pricing?
        <i className="pb-caret" />
      </div>
      <div className="pb-ask-ans">
        <p>Three of seven, in 90 days.</p>
        <ul>
          <li>
            <b>Vantage</b> cut Pro 30%
          </li>
          <li>
            <b>Meridian</b> moved to usage-based
          </li>
          <li>
            <b>Cobalt</b> added a free tier
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
  );
}

// The quarter as one object: thirteen weeks of weekdays, lit by what landed.
function QuarterHeat() {
  return (
    <div className="pb-quarter">
      <div className="pb-qstat">
        <b>127</b>
        <span>moves in Q2</span>
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

// Six words at most per title, and the mark sits inside it rather than above:
// the object under it is what has to be seen first, and every line of chrome
// pushes it further down the card.
type Cell = {
  key: string;
  title: string;
  /** Silk colour — a literal hex, the shader cannot read a var(). */
  tint: string;
  Sigil: () => ReactElement;
  Viz: () => ReactElement;
};

const CARDS: Cell[] = [
  {
    key: "signal",
    title: "What changed, and what to do.",
    tint: "#2e2024",
    Sigil: SigilSignal,
    Viz: SignalCard,
  },
  {
    key: "overview",
    title: "Ranked by what moved.",
    tint: "#1f2a29",
    Sigil: SigilOverview,
    Viz: MarketBoard,
  },
  {
    key: "ask",
    title: "Ask your market.",
    tint: "#1e2533",
    Sigil: SigilAsk,
    Viz: AskScreen,
  },
  {
    key: "battle",
    title: "Battle cards, rewritten.",
    tint: "#302921",
    Sigil: SigilBattle,
    Viz: BattleCard,
  },
  {
    key: "aiv",
    title: "Where you rank in AI answers.",
    tint: "#262533",
    Sigil: SigilAiv,
    Viz: RankLadder,
  },
  {
    key: "recap",
    title: "Your quarter.",
    tint: "#202a29",
    Sigil: SigilRecap,
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
            <h3>
              <card.Sigil />
              {card.title}
            </h3>
          </div>
          <div className="pb-viz" aria-hidden="true">
            <card.Viz />
          </div>
        </article>
      ))}
    </div>
  );
}
