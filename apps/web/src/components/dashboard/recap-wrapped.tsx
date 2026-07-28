"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { AnimatePresence, motion } from "motion/react";
import {
  CaretLeftIcon,
  CaretRightIcon,
  SparkleIcon,
  ArrowUpRightIcon,
} from "@phosphor-icons/react/ssr";
import { api, type MonthlyRecap } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { ShareRecapButton } from "./share-recap-button";

// Monthly "Competitive Recap" — Wrapped-style (Lever 9). A full-bleed slideshow of
// animated stat cards built from buildMonthlyRecap. The email teaser drives here.

// ── count-up number (rAF, easeOutCubic — no extra deps) ───────────────────────
function Counter({ to }: { to: number }) {
  const [n, setN] = useState(0);
  useEffect(() => {
    let raf = 0;
    const start = performance.now();
    const dur = 1100;
    const tick = (now: number) => {
      const p = Math.min((now - start) / dur, 1);
      setN(Math.round(to * (1 - Math.pow(1 - p, 3))));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [to]);
  return <span>{n.toLocaleString("en-US")}</span>;
}

// Each card shares a staggered reveal. Accent tints rotate through the semantic tokens
// (link / positive / high / critical) so the deck feels alive but stays on-brand.
const ACCENTS = ["--link", "--positive", "--high", "--critical"] as const;

const container = {
  hidden: {},
  show: { transition: { staggerChildren: 0.14, delayChildren: 0.1 } },
};
const item = {
  hidden: { opacity: 0, y: 24 },
  show: { opacity: 1, y: 0, transition: { type: "spring" as const, stiffness: 260, damping: 26 } },
};

function Slide({ accent, children }: { accent: string; children: React.ReactNode }) {
  return (
    <motion.div
      variants={container}
      initial="hidden"
      animate="show"
      exit={{ opacity: 0, transition: { duration: 0.2 } }}
      className="absolute inset-0 flex flex-col items-center justify-center px-6 text-center"
      style={{
        background: `radial-gradient(120% 90% at 50% 0%, color-mix(in oklab, var(${accent}) 22%, transparent), transparent 70%)`,
      }}
    >
      <div className="w-full max-w-lg">{children}</div>
    </motion.div>
  );
}

const Big = ({ children, className = "" }: { children: React.ReactNode; className?: string }) => (
  <motion.div
    variants={item}
    className={`text-[clamp(2.75rem,9vw,5rem)] font-semibold leading-[1.02] tracking-tight ${className}`}
  >
    {children}
  </motion.div>
);
const Lead = ({ children }: { children: React.ReactNode }) => (
  <motion.p variants={item} className="mt-4 text-lead text-muted-foreground">
    {children}
  </motion.p>
);
const Eyebrow = ({ children }: { children: React.ReactNode }) => (
  <motion.p variants={item} className="mb-4 text-meta font-medium uppercase tracking-wide text-muted-foreground">
    {children}
  </motion.p>
);

// Build the ordered slides for a recap (skips cards with no data). In `publicMode`
// (a shared link) the dashboard-only links are dropped for a "Powered by Outrival" close.
function buildSlides(r: MonthlyRecap, publicMode: boolean): React.ReactNode[] {
  const slides: React.ReactNode[] = [];
  const a = (i: number) => ACCENTS[i % ACCENTS.length]!;

  slides.push(
    <Slide accent={a(0)}>
      <Eyebrow>{r.month.label}</Eyebrow>
      <Big>Your month in competitive intel</Big>
      <Lead>A quick recap of what your competitors did, and what you caught.</Lead>
    </Slide>,
  );

  if (r.isEmpty) {
    slides.push(
      <Slide accent={a(1)}>
        <Eyebrow>All quiet</Eyebrow>
        <Big>No major moves</Big>
        <Lead>
          {r.pagesChecked != null
            ? `We checked ${r.pagesChecked.toLocaleString("en-US")} pages across ${r.competitorsTracked} competitor${r.competitorsTracked === 1 ? "" : "s"}. They held steady.`
            : `We watched ${r.competitorsTracked} competitor${r.competitorsTracked === 1 ? "" : "s"}. They held steady.`}
        </Lead>
      </Slide>,
    );
  } else {
    slides.push(
      <Slide accent={a(1)}>
        <Eyebrow>The headline</Eyebrow>
        <Big>
          <Counter to={r.totalMoves} /> move{r.totalMoves === 1 ? "" : "s"}
        </Big>
        <Lead>
          caught across {r.competitorsTracked} competitor{r.competitorsTracked === 1 ? "" : "s"}
          {r.pagesChecked != null ? ` · ${r.pagesChecked.toLocaleString("en-US")} pages checked` : ""}.
        </Lead>
      </Slide>,
    );

    if (r.busiest) {
      slides.push(
        <Slide accent={a(2)}>
          <Eyebrow>Most active</Eyebrow>
          <Big>{r.busiest.name}</Big>
          <Lead>
            moved <Counter to={r.busiest.count} />×, your busiest competitor this month.
          </Lead>
        </Slide>,
      );
    }

    if (r.quietest) {
      slides.push(
        <Slide accent={a(3)}>
          <Eyebrow>Radio silence</Eyebrow>
          <Big>{r.quietest.name}</Big>
          <Lead>stayed quiet, no moves we could see.</Lead>
        </Slide>,
      );
    }

    if (r.biggestMove) {
      slides.push(
        <Slide accent={a(4)}>
          <Eyebrow>Biggest move</Eyebrow>
          <motion.div variants={item} className="text-title-lg font-semibold tracking-tight">
            {r.biggestMove.competitorName}
          </motion.div>
          <motion.p variants={item} className="mt-3 text-lead leading-snug">
            {r.biggestMove.insight}
          </motion.p>
          {!publicMode && (
            <motion.div variants={item} className="mt-5">
              <Button asChild variant="outline" size="sm">
                <Link href="/dashboard/signals">See the signal</Link>
              </Button>
            </motion.div>
          )}
        </Slide>,
      );
    }

    if (r.categoryBreakdown.length > 0) {
      slides.push(
        <Slide accent={a(5)}>
          <Eyebrow>Where the action was</Eyebrow>
          <motion.div variants={item} className="mx-auto mt-2 w-full max-w-sm space-y-3 text-left">
            {r.categoryBreakdown.slice(0, 5).map((c) => (
              <div key={c.category}>
                <div className="mb-1 flex items-baseline justify-between text-sm">
                  <span className="capitalize">{c.category}</span>
                  <span className="tabular-nums text-muted-foreground">{c.pct}%</span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-muted">
                  <motion.div
                    className="h-full rounded-full bg-link"
                    initial={{ width: 0 }}
                    animate={{ width: `${c.pct}%` }}
                    transition={{ duration: 0.9, ease: "easeOut", delay: 0.3 }}
                  />
                </div>
              </div>
            ))}
          </motion.div>
        </Slide>,
      );
    }

    if (r.topExposure) {
      slides.push(
        <Slide accent={a(6)}>
          <Eyebrow>Your watch-out</Eyebrow>
          <Big className="capitalize">{r.topExposure.category}</Big>
          <Lead>
            drove the most high-severity moves, where you&apos;re most exposed heading into next month.
          </Lead>
        </Slide>,
      );
    }
  }

  slides.push(
    <Slide accent={a(7)}>
      <motion.div variants={item}>
        <SparkleIcon className="mx-auto mb-4 size-7 text-link" />
      </motion.div>
      <Big>That&apos;s your month.</Big>
      <Lead>We&apos;ll keep watching. See you next month.</Lead>
      <motion.div variants={item} className="mt-6 flex items-center justify-center gap-2">
        {publicMode ? (
          <Button asChild variant="outline" size="sm">
            <Link href="https://outrival.app">
              <SparkleIcon className="size-4 text-link" /> Powered by Outrival
            </Link>
          </Button>
        ) : (
          <>
            <ShareRecapButton month={r.month.key} />
            <Button asChild variant="ghost" size="sm">
              <Link href="/dashboard">
                Back to dashboard <ArrowUpRightIcon className="size-4" />
              </Link>
            </Button>
          </>
        )}
      </motion.div>
    </Slide>,
  );

  return slides;
}

// Presentational slideshow — NO data fetching, so the public share page (outside the
// dashboard's QueryClientProvider) can render it directly with pre-loaded data.
export function RecapDeck({ recap, publicMode = false }: { recap: MonthlyRecap; publicMode?: boolean }) {
  const [i, setI] = useState(0);
  const slides = buildSlides(recap, publicMode);
  const count = slides.length;

  const go = useCallback(
    (dir: number) => setI((prev) => Math.min(Math.max(prev + dir, 0), Math.max(count - 1, 0))),
    [count],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight") go(1);
      else if (e.key === "ArrowLeft") go(-1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go]);

  return (
    <div className="relative min-h-[76vh] overflow-hidden rounded-xl border border-border bg-card">
      {/* progress dots */}
      <div className="absolute inset-x-0 top-0 z-20 flex gap-1.5 p-3">
        {slides.map((_, idx) => (
          <button
            key={idx}
            aria-label={`Card ${idx + 1}`}
            onClick={() => setI(idx)}
            className={`h-1 flex-1 rounded-full transition-colors ${idx <= i ? "bg-foreground/70" : "bg-foreground/15"}`}
          />
        ))}
      </div>

      {/* tap zones */}
      <button
        aria-label="Previous"
        onClick={() => go(-1)}
        className="absolute inset-y-0 left-0 z-10 w-1/3 cursor-default focus:outline-none"
      />
      <button
        aria-label="Next"
        onClick={() => go(1)}
        className="absolute inset-y-0 right-0 z-10 w-2/3 cursor-pointer focus:outline-none"
      />

      <div className="relative min-h-[76vh]">
        <AnimatePresence mode="wait">
          <motion.div key={i} className="absolute inset-0">
            {slides[i]}
          </motion.div>
        </AnimatePresence>
      </div>

      {/* explicit prev/next (desktop affordance) */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 flex items-center justify-between p-3">
        <Button
          variant="ghost"
          size="icon"
          className={`pointer-events-auto ${i === 0 ? "invisible" : ""}`}
          onClick={() => go(-1)}
          aria-label="Previous card"
        >
          <CaretLeftIcon className="size-5" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className={`pointer-events-auto ${i === count - 1 ? "invisible" : ""}`}
          onClick={() => go(1)}
          aria-label="Next card"
        >
          <CaretRightIcon className="size-5" />
        </Button>
      </div>
    </div>
  );
}

// Dashboard entry — fetches the authed recap (needs the dashboard QueryClientProvider),
// then renders the deck. The public share page renders <RecapDeck> directly instead.
export function RecapWrapped({ month, publicMode = false }: { month?: string; publicMode?: boolean }) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ["recap", month ?? null] as const,
    queryFn: () => api.getRecap(month),
  });

  if (isLoading) {
    return (
      <div className="flex min-h-[70vh] items-center justify-center text-sm text-muted-foreground">
        Assembling your recap…
      </div>
    );
  }
  if (isError || !data) {
    return (
      <div className="flex min-h-[70vh] flex-col items-center justify-center gap-3 text-center">
        <p className="text-sm text-muted-foreground">Your recap isn’t ready yet.</p>
        <Button asChild variant="outline" size="sm">
          <Link href="/dashboard">Back to dashboard</Link>
        </Button>
      </div>
    );
  }
  return <RecapDeck recap={data} publicMode={publicMode} />;
}
