import { expect, test } from "bun:test";
import { firstTextDate, parseTextDate } from "./text-date";

// The fallback that reads a date a listing printed for a human. What is worth
// pinning is not the formats it accepts but the ones it REFUSES: a wrong date
// moves a post in the timeline, in the cadence chart and in the pivot windows,
// where an undated row only says "undated".

const NOW = new Date("2026-08-04T12:00:00.000Z");

test("reads the unambiguous formats, at UTC midnight", () => {
  expect(parseTextDate("June 25, 2026", NOW)).toBe("2026-06-25T00:00:00.000Z");
  expect(parseTextDate("Jun 25 2026", NOW)).toBe("2026-06-25T00:00:00.000Z");
  expect(parseTextDate("June 25th, 2026", NOW)).toBe("2026-06-25T00:00:00.000Z");
  expect(parseTextDate("25 June 2026", NOW)).toBe("2026-06-25T00:00:00.000Z");
  expect(parseTextDate("2026-06-25", NOW)).toBe("2026-06-25T00:00:00.000Z");
  // Dots are day-first wherever they are used, so this one is not ambiguous.
  expect(parseTextDate("25.06.2026", NOW)).toBe("2026-06-25T00:00:00.000Z");
  // A byline around the date is normal; the date is still the date.
  expect(parseTextDate("By Ada Lovelace · June 25, 2026", NOW)).toBe("2026-06-25T00:00:00.000Z");
});

test("UTC is explicit, so the day cannot shift with the server's timezone", () => {
  // `new Date("June 25, 2026")` is parsed in the LOCAL zone: on a Europe/Paris
  // box that is 23:00 on the 24th, and the tab renders its dates in UTC.
  const iso = parseTextDate("June 25, 2026", NOW);
  expect(new Date(iso!).getUTCDate()).toBe(25);
  expect(new Date(iso!).getUTCHours()).toBe(0);
});

test("refuses what it cannot read one way only", () => {
  // 06/25 or 25/06? The page does not say, and half the world reads each.
  expect(parseTextDate("06/25/2026", NOW)).toBeNull();
  expect(parseTextDate("25/06/2026", NOW)).toBeNull();
  // A year on its own is a copyright line, not a publication.
  expect(parseTextDate("© 2026 Acme Inc.", NOW)).toBeNull();
  expect(parseTextDate("5 min read", NOW)).toBeNull();
  // A day that does not exist is a parse accident, not the 1st of July.
  expect(parseTextDate("June 31, 2026", NOW)).toBeNull();
  // Dated ahead of the capture: not a publication we can stand behind.
  expect(parseTextDate("December 25, 2026", NOW)).toBeNull();
  // Older than the web we monitor.
  expect(parseTextDate("June 25, 1994", NOW)).toBeNull();
});

test("a date inside prose is a quote, not a publication date", () => {
  const excerpt =
    "Back in June 25, 2026 we rewrote the scheduler, and this post explains what we learned from it.";
  expect(firstTextDate([excerpt], NOW)).toBeNull();
  // The same date standing on its own, the way a byline prints it, is read.
  expect(firstTextDate([excerpt, "June 25, 2026"], NOW)).toBe("2026-06-25T00:00:00.000Z");
});
