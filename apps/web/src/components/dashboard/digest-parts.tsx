import Link from "next/link";
import { cn } from "@/lib/utils";
import { COMP_ACCENT, competitorColorVars } from "@/lib/competitor-color";
import type { DigestMover, DigestStats } from "@/lib/digest-shape";
import { CompAvatar } from "./comp-avatar";

/** Look up a competitor's stored colour by name, case-insensitively. */
export type ColorOf = (name: string) => string | null;

/** Look up a competitor's site by name, case-insensitively. Null = no favicon to draw. */
export type UrlOf = (name: string) => string | null;

/** The neutral tint a competitor with no assigned colour falls back to. */
const NEUTRAL = "var(--border-strong)";

function tintStyle(color: string | null): React.CSSProperties {
  const vars = competitorColorVars(color);
  return vars ? { ...vars, background: COMP_ACCENT } : { background: NEUTRAL };
}

function textTintStyle(color: string | null): React.CSSProperties | undefined {
  const vars = competitorColorVars(color);
  return vars ? { ...vars, color: COMP_ACCENT } : undefined;
}

/**
 * A rail/aside label. Small caps rather than a heading: these name a column of
 * facts, they do not open a section of prose.
 */
export function RailLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-meta uppercase tracking-wider text-muted-foreground">{children}</div>
  );
}

/**
 * Three rising bars for the week's temperature. "Moderate" on its own says nothing;
 * a shape next to the word gives the reading a scale to sit on.
 */
export function ActivityGauge({
  level,
  className,
}: {
  level: "low" | "moderate" | "high";
  className?: string;
}) {
  const lit = level === "high" ? 3 : level === "moderate" ? 2 : 1;
  const tone = level === "high" ? "bg-high" : level === "moderate" ? "bg-medium" : "bg-low";
  return (
    <span
      className={cn("inline-flex items-end gap-0.5 h-3", className)}
      aria-hidden
    >
      {[5, 8, 11].map((h, i) => (
        <span
          key={h}
          style={{ height: `${h}px` }}
          className={cn("w-[3px] rounded-[1px]", i < lit ? tone : "bg-surface-3")}
        />
      ))}
    </span>
  );
}

/**
 * The week split into what to answer, what to watch, and what was noted. Encodes the
 * shape of a week in form as well as in number, so a heavy week reads before it is
 * counted. Purely decorative: every segment is also stated in the line beneath it.
 */
export function SpreadBar({ stats, className }: { stats: DigestStats; className?: string }) {
  if (stats.moves === 0) {
    return (
      <span
        className={cn("flex h-1 rounded-[1px] bg-surface-3", className)}
        aria-hidden
      />
    );
  }
  const segments = [
    { n: stats.action, cls: "bg-critical" },
    { n: stats.watch, cls: "bg-high" },
    { n: stats.fyi, cls: "bg-low" },
  ].filter((s) => s.n > 0);

  return (
    <span className={cn("flex h-1 gap-0.5", className)} aria-hidden>
      {segments.map((s) => (
        <span
          key={s.cls}
          style={{ flexGrow: s.n }}
          className={cn("rounded-[1px]", s.cls)}
        />
      ))}
    </span>
  );
}

/** How a week's spread reads in words, so the bar never carries meaning alone. */
export function spreadSentence(stats: DigestStats): string {
  if (stats.moves === 0) return "Nothing to answer";
  if (stats.action > 0) {
    return `${stats.action} need${stats.action === 1 ? "s" : ""} an answer`;
  }
  return `${stats.moves} move${stats.moves === 1 ? "" : "s"}, none urgent`;
}

/**
 * Who moved in one line of a list row.
 *
 * This used to be a row of tinted dots, which assumed every competitor carries an
 * assigned colour. Most do not: the palette is opt-in, so the dots rendered as a
 * line of identical grey circles that said nothing and could only be decoded by
 * hovering. Names answer the question at a glance; the tint, when there is one,
 * is a bonus rather than the whole message.
 */
export function CompetitorMovers({
  movers,
  colorOf,
  max = 2,
}: {
  movers: DigestMover[];
  colorOf: ColorOf;
  max?: number;
}) {
  if (movers.length === 0) {
    return <span className="truncate text-dense text-muted-foreground">Nobody</span>;
  }
  const shown = movers.slice(0, max);
  const rest = movers.length - shown.length;
  return (
    <span className="flex min-w-0 items-center gap-1.5 text-dense" title={movers.map((m) => m.name).join(", ")}>
      <span className="truncate">
        {shown.map((m, i) => (
          <span key={m.name}>
            {i > 0 && <span className="text-muted-foreground">, </span>}
            <span style={textTintStyle(colorOf(m.name))}>{m.name}</span>
          </span>
        ))}
      </span>
      {rest > 0 && (
        <span className="shrink-0 font-mono text-xs text-muted-foreground">+{rest}</span>
      )}
    </span>
  );
}

/**
 * The week by company: who moved, how often, and what share of the brief they are.
 * Answers the second question a brief raises ("is this one company or the market?")
 * which a flat list of moves hides.
 *
 * One line per competitor, and capped. An org watching fifteen competitors turned
 * this into a 550px column that dwarfed the brief it was supposed to annotate, and
 * listing the ones that did NOT move padded it with rows reading "0".
 */
export function MoverList({
  movers,
  total,
  colorOf,
  idOf,
  urlOf,
  max = 6,
}: {
  movers: DigestMover[];
  total: number;
  colorOf: ColorOf;
  /** Resolves a competitor name to its page, when we hold one. */
  idOf?: (name: string) => string | null;
  /** Resolves a competitor name to its site, so the row can carry its mark. */
  urlOf?: UrlOf;
  /** How many rows before the list folds. The rest open on demand. */
  max?: number;
}) {
  const head = movers.slice(0, max);
  const tail = movers.slice(max);

  // A native disclosure rather than component state: this file is imported by the
  // server-rendered public sample page, and folding a list is not worth a client
  // boundary or a hydration pass.
  return (
    <div className="flex flex-col gap-2">
      <MoverRows rows={head} total={total} colorOf={colorOf} idOf={idOf} urlOf={urlOf} />
      {tail.length > 0 && (
        <details className="group flex flex-col gap-2">
          <summary className="cursor-pointer list-none text-dense text-link marker:hidden hover:underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <span className="group-open:hidden">Show all {movers.length}</span>
            <span className="hidden group-open:inline">Show less</span>
          </summary>
          <div className="mt-1.5">
            <MoverRows rows={tail} total={total} colorOf={colorOf} idOf={idOf} urlOf={urlOf} />
          </div>
        </details>
      )}
    </div>
  );
}

function MoverRows({
  rows,
  total,
  colorOf,
  idOf,
  urlOf,
}: {
  rows: DigestMover[];
  total: number;
  colorOf: ColorOf;
  idOf?: (name: string) => string | null;
  urlOf?: UrlOf;
}) {
  return (
    <ul className="flex flex-col gap-2">
      {rows.map((m) => {
        const color = colorOf(m.name);
        const id = idOf?.(m.name) ?? null;
        const url = urlOf?.(m.name) ?? null;
        const share = total > 0 ? Math.round((m.count / total) * 100) : 0;
        const name = (
          <span className="truncate" style={textTintStyle(color)}>
            {m.name}
          </span>
        );
        return (
          <li key={m.name} className="flex items-center gap-2 text-dense">
            {/* The company's own mark rather than a tinted dot: the palette is opt-in,
                so most rows drew the same grey circle. The favicon names the company
                before the text is read, and falls back to its initial on its own. The
                tint it used to carry still reads on the name and the share bar. */}
            <CompAvatar name={m.name} url={url} size={18} />
            {id ? (
              <Link
                href={`/dashboard/competitors/${id}`}
                className="min-w-0 flex-1 hover:underline underline-offset-2"
              >
                {name}
              </Link>
            ) : (
              <span className="min-w-0 flex-1">{name}</span>
            )}
            <span
              aria-hidden
              className="flex h-1 w-9 shrink-0 overflow-hidden rounded-[2px] bg-surface-3"
            >
              <span
                className="h-full rounded-[2px]"
                style={{ width: `${share}%`, ...tintStyle(color) }}
              />
            </span>
            <span className="w-4 shrink-0 text-right font-mono text-xs tabular-nums text-muted-foreground">
              {m.count}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

/** A competitor's name in its own tint, with a dot. The brief's byline. */
export function MoverName({
  name,
  color,
  href,
}: {
  name: string;
  color: string | null;
  href?: string | null;
}) {
  const body = (
    <>
      <span aria-hidden className="size-[7px] shrink-0 rounded-full" style={tintStyle(color)} />
      <span className="font-medium" style={textTintStyle(color)}>
        {name}
      </span>
    </>
  );
  if (!href) return <span className="inline-flex items-center gap-2">{body}</span>;
  return (
    <Link
      href={href}
      className="inline-flex items-center gap-2 hover:underline underline-offset-2"
    >
      {body}
    </Link>
  );
}
