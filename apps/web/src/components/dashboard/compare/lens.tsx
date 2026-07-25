"use client";

import { type CSSProperties, type ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ChevronRight } from "lucide-react";
import type { CompareColumn } from "@/lib/api";
import { CompAvatar } from "@/components/dashboard/comp-avatar";
import { SectionHead } from "@/components/dashboard/section-head";
import { Skeleton } from "@/components/ui/skeleton";
import {
  COMP_ACCENT,
  COMP_ON_FILL,
  competitorColorVars,
  competitorNameColor,
} from "@/lib/competitor-color";
import { feedItemTransition, feedItemVariants } from "@/lib/motion";
import { cn } from "@/lib/utils";

/**
 * The shared row grammar of the compare page. Every lens (price, rating, hiring,
 * stack…) lists the SAME roster in the SAME order, so a competitor tracks vertically
 * down the page and the whole screen reads as one comparison instead of five widgets.
 *
 * Rows, not columns: the old matrix froze two columns and scrolled the rest sideways,
 * which no phone could hold. A row per competitor scales down for free.
 */

/** One compared entity: the picker's identity plus its loaded column (null while pending). */
export interface CompareEntity {
  id: string;
  name: string;
  /** One of the org's own products — wears the accent and the You tag. */
  mine: boolean;
  color: string | null;
  url: string | null;
  data: CompareColumn | null;
  pending: boolean;
}

// Enter/exit choreography borrowed from the roster feed. `layout="position"` rather
// than the roster's full `layout`: rows slide up as a removed competitor leaves, but
// their SIZE is never animated, so it can't fight (or distort) the height animation of
// a row expanding beneath its own bar.
const rowMotion = {
  layout: "position",
  variants: feedItemVariants,
  initial: "initial",
  animate: "animate",
  exit: "exit",
  transition: feedItemTransition,
} as const;

// Name track flexes between a phone and a wide column; the value track sizes to its
// longest reading. Everything in between is the measure itself.
const ROW_GRID =
  "grid items-center gap-x-3 grid-cols-[minmax(5.5rem,9rem)_minmax(0,1fr)_auto]";

/** "You" marker: accent fill, ink label, sentence case. Same object in the rail and the rows. */
export function YouTag() {
  return (
    <span className="bg-primary text-primary-foreground inline-flex shrink-0 items-center rounded-[4px] px-1.5 py-0.5 text-meta font-semibold leading-none">
      You
    </span>
  );
}

/** Boxless lens: a SectionHead, the rows, then the axis and legend the rows are read on. */
export function Lens({
  id,
  title,
  sub,
  meta,
  intro,
  children,
  footer,
}: {
  id: string;
  title: string;
  sub?: string;
  /** Right-hand unit note ("USD / mo", "out of 5"). */
  meta?: ReactNode;
  /** A line that belongs to the whole lens, above the rows (kept out of the
      presence list, which only owns the rows). */
  intro?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    // scroll-mt clears the sticky topbar when a verdict fact scrolls here.
    <section id={id} className="min-w-0 scroll-mt-20">
      <SectionHead
        title={title}
        sub={sub}
        action={
          meta ? (
            <span className="text-muted-foreground font-mono text-meta">{meta}</span>
          ) : undefined
        }
      />
      {intro}
      <div className="flex flex-col">
        {/* popLayout takes the leaving row out of flow, so the rows below it close the
            gap while it fades instead of after it. */}
        <AnimatePresence initial={false} mode="popLayout">
          {children}
        </AnimatePresence>
      </div>
      {footer}
    </section>
  );
}

/**
 * The axis under a lens, and its legend. Wears the row's own column template so the
 * ticks land under the track they label rather than under the whole section.
 */
export function LensFooter({
  ticks,
  legend,
}: {
  ticks?: ReactNode[];
  legend?: ReactNode;
}) {
  if (!ticks && !legend) return null;
  return (
    <div className={cn(ROW_GRID, "mt-0")}>
      <div className="col-start-2 flex flex-col gap-1.5">
        {ticks && (
          <div className="text-muted-foreground flex justify-between pt-1.5 font-mono text-meta tabular-nums">
            {ticks.map((t, i) => (
              <span key={i}>{t}</span>
            ))}
          </div>
        )}
        {legend && (
          <div className="text-muted-foreground flex flex-wrap items-center gap-x-4 gap-y-1 text-meta">
            {legend}
          </div>
        )}
      </div>
    </div>
  );
}

/** The dashed reference tick used in a legend, so it reads as the same mark as the chart. */
export function LegendMedian({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-2">
      <span
        aria-hidden
        className="border-border-strong inline-block h-3 border-l border-dashed"
      />
      {children}
    </span>
  );
}

export function LegendSwatch({
  className,
  style,
  children,
}: {
  className?: string;
  style?: CSSProperties;
  children: ReactNode;
}) {
  return (
    <span className="inline-flex items-center gap-2">
      <span
        aria-hidden
        className={cn("inline-block h-1.5 w-4 rounded-[2px]", className)}
        style={style}
      />
      {children}
    </span>
  );
}

/**
 * One competitor's row in a lens. The identity sits left, the measure in the middle,
 * the machine's number right. `detail` makes the row expandable in place: the bar
 * stays on screen and the breakdown opens beneath it, indented under the measure.
 */
export function MeasureRow({
  entity,
  value,
  open,
  onToggle,
  detail,
  children,
}: {
  entity: CompareEntity;
  value?: ReactNode;
  open?: boolean;
  onToggle?: () => void;
  detail?: ReactNode;
  children: ReactNode;
}) {
  const expandable = Boolean(detail && onToggle);
  const identity = (
    <>
      {expandable ? (
        <ChevronRight
          size={13}
          aria-hidden
          className={cn(
            "text-muted-foreground shrink-0 motion-safe:transition-transform",
            open && "rotate-90",
          )}
        />
      ) : (
        // Keeps the names aligned across rows whether or not a row can expand.
        <span aria-hidden className="w-[13px] shrink-0" />
      )}
      <CompAvatar name={entity.name} url={entity.url} size={22} />
      <span
        className="truncate text-dense font-medium"
        style={entity.mine ? undefined : competitorNameColor(entity.color)}
      >
        {entity.name}
      </span>
      {entity.mine && <YouTag />}
    </>
  );

  return (
    <motion.div
      {...rowMotion}
      className={cn(
        ROW_GRID,
        "group border-border -mx-1.5 rounded-md border-b px-1.5 py-2 transition-colors",
        entity.mine ? "bg-primary/[0.04] hover:bg-primary/[0.07]" : "hover:bg-surface-2",
      )}
    >
      {expandable ? (
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          className="focus-visible:ring-ring/50 flex min-w-0 items-center gap-2 rounded-sm text-left focus-visible:ring-2"
        >
          {identity}
        </button>
      ) : (
        <span className="flex min-w-0 items-center gap-2">{identity}</span>
      )}

      <div className="min-w-0">{children}</div>

      {value !== undefined && (
        <span className="text-right font-mono text-dense whitespace-nowrap tabular-nums">
          {value}
        </span>
      )}

      <AnimatePresence initial={false}>
        {open && detail && (
          <motion.div
            key="detail"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.18, ease: "easeOut" }}
            className="col-start-2 col-end-[-1] overflow-hidden"
          >
            {detail}
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

/**
 * The prose form of a row, for the lenses whose reading is a sentence rather than a
 * measure (positioning, latest move). Same identity block, top-aligned, with an
 * optional severity gutter on the left and a mono reading on the right.
 */
export function WideRow({
  entity,
  gutter,
  right,
  children,
}: {
  entity: CompareEntity;
  gutter?: ReactNode;
  right?: ReactNode;
  children: ReactNode;
}) {
  return (
    <motion.div
      {...rowMotion}
      className={cn(
        "border-border -mx-1.5 grid items-start gap-x-3 rounded-md border-b px-1.5 py-2.5 transition-colors",
        gutter
          ? "grid-cols-[0.625rem_minmax(6rem,10rem)_minmax(0,1fr)_auto]"
          : "grid-cols-[minmax(6rem,10rem)_minmax(0,1fr)]",
        entity.mine ? "bg-primary/[0.04]" : "hover:bg-surface-2",
      )}
    >
      {gutter}
      <span className="flex min-w-0 items-center gap-2 pt-px">
        <CompAvatar name={entity.name} url={entity.url} size={22} />
        <span
          className="truncate text-dense font-medium"
          style={entity.mine ? undefined : competitorNameColor(entity.color)}
        >
          {entity.name}
        </span>
        {entity.mine && <YouTag />}
      </span>
      <div className="min-w-0">{children}</div>
      {right}
    </motion.div>
  );
}

/** A row whose column has not arrived yet: identity is known, the measure is not. */
export function PendingRow({ entity }: { entity: CompareEntity }) {
  return (
    <motion.div
      {...rowMotion}
      className={cn(ROW_GRID, "border-border -mx-1.5 border-b px-1.5 py-2")}
    >
      <span className="flex min-w-0 items-center gap-2">
        <span aria-hidden className="w-[13px] shrink-0" />
        <CompAvatar name={entity.name} url={entity.url} size={22} />
        <span className="truncate text-dense font-medium text-muted-foreground">
          {entity.name}
        </span>
      </span>
      <Skeleton className="h-2 w-full" />
      <Skeleton className="h-3 w-12" />
    </motion.div>
  );
}

/** The 0-to-max lane a bar is drawn in. */
export function Track({ children }: { children: ReactNode }) {
  return (
    <div className="bg-surface-2 ring-border relative h-2 rounded-[3px] ring-1 ring-inset">
      {children}
    </div>
  );
}

/**
 * A span of the track. Wears the competitor's own identity colour (the same hue its
 * name, chip and avatar carry everywhere else); your product wears the accent, which
 * is the one place the rationed cyan is spent on this page.
 */
export function Bar({
  entity,
  left,
  width,
  className,
}: {
  entity: CompareEntity;
  /** Percentages of the track. */
  left: number;
  width: number;
  className?: string;
}) {
  const vars = competitorColorVars(entity.color);
  return (
    <span
      aria-hidden
      className={cn(
        "absolute inset-y-0 rounded-[3px] motion-safe:transition-[left,width] motion-safe:duration-300 motion-safe:ease-out",
        entity.mine ? "bg-primary" : !vars && "bg-border-strong",
        className,
      )}
      style={{
        left: `${left}%`,
        // A single-point reading (one flat price) still has to be visible.
        width: `max(${width}%, 5px)`,
        ...(entity.mine || !vars ? {} : { ...vars, background: COMP_ACCENT }),
      }}
    />
  );
}

/**
 * An inner, higher-contrast span picking a share out of a bar (engineering of total).
 * Keeps the competitor's hue and takes it a lightness step further from the surface
 * (COMP_ON_FILL), so the share reads apart from the total without a second colour
 * system. The 2px surface ring is the spacer that stops the two fills touching.
 */
export function BarShare({
  entity,
  width,
}: {
  entity: CompareEntity;
  width: number;
}) {
  const vars = competitorColorVars(entity.color);
  return (
    <span
      aria-hidden
      className={cn(
        "ring-background absolute inset-y-0 left-0 rounded-[3px] ring-2 motion-safe:transition-[width] motion-safe:duration-300",
        entity.mine
          ? "bg-[color-mix(in_oklab,var(--accent)_55%,var(--foreground))]"
          : !vars && "bg-muted-foreground",
      )}
      style={{
        width: `max(${width}%, 3px)`,
        ...(entity.mine || !vars ? {} : { ...vars, background: COMP_ON_FILL }),
      }}
    />
  );
}

/** The dashed median reference, drawn through every row of a lens. */
export function MedianMark({ left }: { left: number }) {
  return (
    <span
      aria-hidden
      className="border-border-strong absolute -inset-y-1 border-l border-dashed"
      style={{ left: `${left}%` }}
    />
  );
}

/** Hatched marker for a competitor who publishes no number at all. */
export function QuoteOnly() {
  return (
    <span className="text-muted-foreground ring-border inline-flex h-2 items-center rounded-[3px] bg-[repeating-linear-gradient(135deg,var(--surface-3)_0_3px,transparent_3px_6px)] px-1.5 text-meta ring-1 ring-inset">
      quote only
    </span>
  );
}

/** Where a row's breakdown lives: a provenance line, then tight key/value pairs. */
export function Detail({
  source,
  children,
  wide,
}: {
  source?: ReactNode;
  children: ReactNode;
  wide?: boolean;
}) {
  return (
    <div className="flex flex-col gap-1 pt-2 pb-1">
      {source && <span className="text-muted-foreground text-meta">{source}</span>}
      <div
        className={cn(
          "grid justify-start gap-x-6 gap-y-0.5",
          wide
            ? "grid-cols-[repeat(auto-fit,minmax(10.75rem,16rem))]"
            : "grid-cols-[repeat(auto-fit,minmax(7.25rem,11.25rem))]",
        )}
      >
        {children}
      </div>
    </div>
  );
}

export function DetailPair({ label, value }: { label: string; value: ReactNode }) {
  return (
    <span className="flex items-baseline justify-between gap-2.5 text-xs">
      <span className="text-muted-foreground truncate">{label}</span>
      <span className="font-mono tabular-nums">{value}</span>
    </span>
  );
}

/** A detail pair carrying its own share bar (sub-scores, department mix). */
export function DetailBar({
  entity,
  label,
  value,
  ratio,
}: {
  entity: CompareEntity;
  label: string;
  value: ReactNode;
  /** 0-1 of the row's own maximum. */
  ratio: number;
}) {
  const vars = competitorColorVars(entity.color);
  return (
    <span className="grid grid-cols-[4.75rem_minmax(0,1fr)_auto] items-center gap-2 text-xs">
      <span className="text-muted-foreground truncate">{label}</span>
      <span className="bg-surface-3 h-1 overflow-hidden rounded-[2px]">
        <span
          aria-hidden
          className={cn(
            "block h-full rounded-[2px]",
            entity.mine ? "bg-primary" : !vars && "bg-border-strong",
          )}
          style={{
            width: `${Math.max(0, Math.min(1, ratio)) * 100}%`,
            ...(entity.mine || !vars ? {} : { ...vars, background: COMP_ACCENT }),
          }}
        />
      </span>
      <span className="font-mono tabular-nums">{value}</span>
    </span>
  );
}

/** Nothing captured for this competitor on this measure. */
export function NoReading({ children }: { children: ReactNode }) {
  return <span className="text-muted-foreground text-dense">{children}</span>;
}
