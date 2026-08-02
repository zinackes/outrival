/**
 * The window the weekly digest cron is currently filling, and when it will close it.
 *
 * Mirrors `generate-weekly-digest`: it fires on `CRON_SCHEDULES["generate-weekly-digest"]`
 * (Monday 08:00 UTC) and covers `[monday-7d, monday)`. The window open right now is
 * therefore the one belonging to the NEXT fire, which is why this is computed from the
 * fire time and not from "today at midnight" — during Monday 00:00-08:00 the run has
 * not happened yet, so the open window is still the previous Monday's, and anchoring on
 * midnight would roll it over eight hours early and blank the card on the one morning
 * the user is most likely to look.
 *
 * Lives in its own module so it can be tested without importing the route (and with it
 * the db, Resend and AI clients).
 */
export function inProgressWindow(now: Date): { start: Date; end: Date; nextRunAt: Date } {
  const nextRunAt = new Date(now);
  nextRunAt.setUTCHours(8, 0, 0, 0);
  // Mon=1 … Sun=0, so (8 - day) % 7 is the number of days to the next Monday.
  nextRunAt.setUTCDate(nextRunAt.getUTCDate() + ((8 - nextRunAt.getUTCDay()) % 7));
  if (nextRunAt <= now) nextRunAt.setUTCDate(nextRunAt.getUTCDate() + 7);

  const end = new Date(nextRunAt);
  end.setUTCHours(0, 0, 0, 0);
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - 7);
  return { start, end, nextRunAt };
}
