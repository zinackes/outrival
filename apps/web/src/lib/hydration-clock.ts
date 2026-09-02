// Which clock a date is read on, so a first render can agree with the server's.
//
// date-fns formats in the runtime's own timezone: UTC on the server, the viewer's
// in the browser. Anything derived from a calendar day therefore disagrees between
// the two for every instant within the viewer's UTC offset of midnight — and when
// that value is a day BUCKET the disagreement is structural (a different set of day
// sections), which `suppressHydrationWarning` cannot cover: React discards the tree
// and re-renders it (React #418, `code:PER-24`).
//
// So the first pass runs on a clock both sides derive identically, and the viewer's
// own days are adopted on mount. Same two-pass shape as the OUT-185 fix in
// `overview.tsx`, which seeds its range from `lastNUtcDays` and swaps to local in an
// effect. The `local` flag is `useHydrated()` at the call site.

/**
 * The instant to format.
 *
 * `local: true` hands the instant back untouched — the viewer's own clock, which is
 * what they should end up reading. `local: false` shifts it so that formatting it in
 * ANY runtime timezone prints its UTC wall clock, the one reading a server and a
 * browser can both derive.
 *
 * The shift uses the offset AT that instant, not at "now", so a summer timestamp read
 * in winter still lands on its own UTC reading instead of drifting by an hour.
 */
export function onClock(input: Date | string | number, local: boolean): Date {
  const d = input instanceof Date ? input : new Date(input);
  return local ? d : new Date(d.getTime() + d.getTimezoneOffset() * 60_000);
}

/** "Now" on the same clock — what a "is this today?" test has to compare against. */
export function nowOnClock(local: boolean): Date {
  return onClock(Date.now(), local);
}
