import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * Four kinds of data, four marks.
 *
 * The competitor page used to render every value as the same object: a pill with
 * a tinted fill, a coloured border AND coloured text, at full radius. Three
 * coloured edges on a 20px element is what makes an interface read as generated,
 * and using one object for statuses, categories, levels and plain attributes
 * leaves nothing to scan by. These are the four treatments that replace it.
 *
 *   StatusDot  a small closed set of states (fresh / stale / failing). No
 *              container, because reading a coloured dot takes no thought.
 *   CatBadge   a nominal label out of many (a signal category). It DOES get a
 *              container, tinted at 16% of its own hue with the text in that
 *              same hue and NO border, the Stripe / Linear / Vercel recipe.
 *   FactStrip  several attributes of one object. Label over value on a baseline
 *              grid: that is a table, not a row of chips.
 *   Verdict    the one sentence the tab exists to answer, above the evidence.
 *
 * Severity is deliberately absent: it is ordinal, and <SeverityScale> already
 * ships that encoding (four equal ticks). See severity-scale.tsx.
 */

type Tone = "neutral" | "good" | "warn" | "bad";

const DOT_TONE: Record<Tone, string> = {
  neutral: "bg-muted-foreground",
  good: "bg-positive",
  warn: "bg-medium",
  bad: "bg-critical",
};

/** Dot + neutral text. The colour lives in the dot; the label never tints. */
export function StatusDot({
  tone = "neutral",
  className,
  children,
}: {
  tone?: Tone;
  className?: string;
  children?: React.ReactNode;
}) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-xs text-muted-foreground", className)}>
      <span aria-hidden className={cn("size-1.5 shrink-0 rounded-full", DOT_TONE[tone])} />
      {children}
    </span>
  );
}

/* Tinted fill + same-hue text, no border, badge radius. Class strings are spelled
   out in full so Tailwind keeps them in the build (same reason as cat-pill.tsx). */
const CAT_BADGE: Record<string, string> = {
  pricing: "bg-cat-pricing/16 text-cat-pricing",
  product: "bg-cat-product/16 text-cat-product",
  hiring: "bg-cat-hiring/16 text-cat-hiring",
  reviews: "bg-cat-reviews/16 text-cat-reviews",
  content: "bg-cat-content/16 text-cat-content",
  funding: "bg-cat-funding/16 text-cat-funding",
  api_developer: "bg-cat-api-developer/16 text-cat-api-developer",
  ma: "bg-cat-ma/16 text-cat-ma",
  security_compliance: "bg-cat-security-compliance/16 text-cat-security-compliance",
  ads: "bg-cat-ads/16 text-cat-ads",
  partnerships: "bg-cat-partnerships/16 text-cat-partnerships",
  leadership: "bg-cat-leadership/16 text-cat-leadership",
};

/* Enum values are snake_case; a badge must not read "SECURITY_COMPLIANCE". */
const CAT_LABEL: Record<string, string> = {
  ma: "M&A",
  security_compliance: "Security",
  api_developer: "Developer",
};

/**
 * A signal category. Sentence case, not the uppercase mono of the old pill: the
 * category is a word, not a machine value, and 11px uppercase reads as filler.
 * An unknown value (a competitor's freeform industry) falls back to neutral.
 */
export function CatBadge({ category, className }: { category: string; className?: string }) {
  const key = category.toLowerCase().trim();
  const tint = CAT_BADGE[key] ?? "bg-surface-2 text-muted-foreground";
  const label = CAT_LABEL[key] ?? key.replace(/_/g, " ");
  return (
    <span
      className={cn(
        "inline-flex w-fit shrink-0 items-center rounded-sm px-1.5 py-0.5 text-meta font-medium capitalize",
        tint,
        className,
      )}
    >
      {label}
    </span>
  );
}

/**
 * A row of labelled attributes: label above value, divided by hairlines. Used
 * wherever a tab needs to state several facts about one object (the pricing
 * page, the hiring board, the review source) without turning them into chips.
 */
export function FactStrip({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <dl
      className={cn(
        "grid grid-cols-2 gap-x-0 gap-y-4 sm:grid-cols-4 sm:gap-y-0",
        // Divider on every cell except the first of each row. The 3rd cell starts
        // a new row on the 2-up mobile grid, so its rule is dropped there.
        "[&>div]:border-l [&>div]:border-border [&>div]:pl-4",
        "[&>div:first-child]:border-l-0 [&>div:first-child]:pl-0",
        "[&>div:nth-child(3)]:border-l-0 [&>div:nth-child(3)]:pl-0",
        "sm:[&>div:nth-child(3)]:border-l sm:[&>div:nth-child(3)]:pl-4",
        className,
      )}
    >
      {children}
    </dl>
  );
}

/**
 * One cell of a FactStrip. `tone` adds a dot beside the value for the rare fact
 * that genuinely carries a reading (a rating that fell, a page that just moved);
 * most facts are plain, and a strip where every cell is coloured reads as noise.
 */
export function Fact({
  label,
  tone,
  muted,
  children,
}: {
  label: string;
  tone?: Tone;
  /** The value is an absence ("None", "Not captured") rather than a measurement. */
  muted?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd
        className={cn(
          "flex items-center gap-1.5 text-content",
          muted ? "text-muted-foreground" : "text-foreground",
        )}
      >
        {tone && (
          <span aria-hidden className={cn("size-1.5 shrink-0 rounded-full", DOT_TONE[tone])} />
        )}
        {children}
      </dd>
    </div>
  );
}

/**
 * The answer, before the evidence. Every reading tab opens on one of these: a
 * deterministic sentence computed from the captured data (never generated), and
 * a line of supporting numbers. It replaces the status card that used to sit at
 * the top of a tab telling you how the data was collected rather than what it says.
 */
export function Verdict({
  headline,
  children,
  className,
}: {
  headline: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-1.5 px-5 py-4", className)}>
      <h3 className="text-xl font-semibold leading-snug tracking-tight text-balance">{headline}</h3>
      {children && (
        <p className="max-w-[70ch] text-sm leading-relaxed text-muted-foreground">{children}</p>
      )}
    </div>
  );
}
