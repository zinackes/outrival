import Link from "next/link";
import { cn } from "@/lib/utils";
import { COMP_ACCENT, competitorColorVars } from "@/lib/competitor-color";
import type { DigestMover, DigestStats } from "@/lib/digest-shape";

/** Look up a competitor's stored colour by name, case-insensitively. */
export type ColorOf = (name: string) => string | null;

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

/** Who moved, as a row of tinted dots. Overflow is counted, never truncated silently. */
export function CompetitorPips({
  movers,
  colorOf,
  max = 3,
}: {
  movers: DigestMover[];
  colorOf: ColorOf;
  max?: number;
}) {
  if (movers.length === 0) {
    return <span className="size-[7px] shrink-0 rounded-full bg-surface-3" aria-hidden />;
  }
  const shown = movers.slice(0, max);
  const label = movers.map((m) => m.name).join(", ");
  return (
    <span className="flex items-center gap-1.5" title={label}>
      <span className="sr-only">{label}</span>
      {shown.map((m) => (
        <span
          key={m.name}
          aria-hidden
          className="size-[7px] shrink-0 rounded-full"
          style={tintStyle(colorOf(m.name))}
        />
      ))}
      {movers.length > max && (
        <span className="font-mono text-meta text-muted-foreground" aria-hidden>
          +{movers.length - max}
        </span>
      )}
    </span>
  );
}

/**
 * The week by company: who moved, how often, and what share of the brief they are.
 * Answers the second question a brief raises ("is this one company or the market?")
 * which a flat list of moves hides.
 */
export function MoverList({
  movers,
  total,
  colorOf,
  idOf,
  silent = [],
}: {
  movers: DigestMover[];
  total: number;
  colorOf: ColorOf;
  /** Resolves a competitor name to its page, when we hold one. */
  idOf?: (name: string) => string | null;
  /** Watched competitors that did not move. Their silence is a fact too. */
  silent?: string[];
}) {
  return (
    <ul className="flex flex-col gap-2.5">
      {movers.map((m) => {
        const color = colorOf(m.name);
        const id = idOf?.(m.name) ?? null;
        const share = total > 0 ? Math.round((m.count / total) * 100) : 0;
        const name = (
          <span className="truncate" style={textTintStyle(color)}>
            {m.name}
          </span>
        );
        return (
          <li key={m.name} className="flex flex-col gap-1">
            <div className="flex items-center gap-2 text-dense">
              <span
                aria-hidden
                className="size-[7px] shrink-0 rounded-full"
                style={tintStyle(color)}
              />
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
              <span className="font-mono text-xs tabular-nums text-muted-foreground">
                {m.count}
              </span>
            </div>
            <span className="ml-[15px] flex h-[3px] overflow-hidden rounded-[2px] bg-surface-3" aria-hidden>
              <span
                className="h-full rounded-[2px]"
                style={{ width: `${share}%`, ...tintStyle(color) }}
              />
            </span>
          </li>
        );
      })}
      {silent.map((name) => (
        <li key={name} className="flex items-center gap-2 text-dense text-muted-foreground">
          <span aria-hidden className="size-[7px] shrink-0 rounded-full bg-surface-3" />
          <span className="min-w-0 flex-1 truncate">{name}</span>
          <span className="font-mono text-xs tabular-nums">0</span>
        </li>
      ))}
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
