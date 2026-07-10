import { describe, expect, it } from "bun:test";
import { parseHomepageStructure } from "../../parsers/homepage-structure";
import { diffHomepages, filterUnstableSections } from "../homepage-diff";

const BASE = "https://acme.com/";

// Baseline homepage WITHOUT the flaky section.
const WITHOUT = `<!doctype html><html><head><title>Acme</title></head><body>
  <header><nav><a href="/features">Features</a></nav></header>
  <main>
    <section class="hero"><h1>Ship faster with Acme</h1><p>Platform for teams.</p></section>
    <section><h2>Features</h2><p>Automation and analytics.</p></section>
  </main>
</body></html>`;

// Same page WITH a client-rendered data widget — the section that flickers in and
// out between scrapes and fabricates the phantom "new section" signal.
const WITH = WITHOUT.replace(
  "</main>",
  `<section><h2>Recent Transactions</h2><p>Total volume 1.2M across 340 sales.</p></section></main>`,
);

const parse = (html: string) => parseHomepageStructure(html, BASE);
const hasRecentAdded = (changes: ReturnType<typeof diffHomepages>) =>
  changes.some((c) => c.kind === "section_added" && /recent transactions/i.test(c.after ?? ""));
const hasRecentRemoved = (changes: ReturnType<typeof diffHomepages>) =>
  changes.some((c) => c.kind === "section_removed" && /recent transactions/i.test(c.before ?? ""));

describe("filterUnstableSections — production-shaped history (index[0]=current, index[1]=diff's prev)", () => {
  it("keeps a genuine add: absent in the diff's prev, absent in the whole prior window", () => {
    // diff: prev=WITHOUT (lacks it) → curr=WITH (has it) ⇒ section_added.
    const changes = diffHomepages(parse(WITHOUT), parse(WITH));
    expect(hasRecentAdded(changes)).toBe(true);

    // history[0] = curr (WITH), history[1..3] all lack the section — the
    // regression case that was impossible to confirm since #74.
    const history = [WITH, WITHOUT, WITHOUT, WITHOUT].map(parse);
    const filtered = filterUnstableSections(changes, history);
    expect(hasRecentAdded(filtered)).toBe(true);
  });

  it("suppresses a flickering add: present in the diff's prev window at some point", () => {
    const changes = diffHomepages(parse(WITHOUT), parse(WITH));
    // history[0] = curr (WITH); history[1] = WITHOUT (matches the diff's prev),
    // but history[2] = WITH — the section flickered back in, so it's not
    // confirmed absent for the whole prior window.
    const history = [WITH, WITHOUT, WITH, WITHOUT].map(parse);
    const filtered = filterUnstableSections(changes, history);
    expect(hasRecentAdded(filtered)).toBe(false);
  });

  it("keeps a genuine remove: present in the diff's prev, present in the whole prior window", () => {
    // diff: prev=WITH (has it) → curr=WITHOUT (lacks it) ⇒ section_removed.
    const changes = diffHomepages(parse(WITH), parse(WITHOUT));
    expect(hasRecentRemoved(changes)).toBe(true);

    // history[0] = curr (WITHOUT); history[1..3] all have the section.
    const history = [WITHOUT, WITH, WITH, WITH].map(parse);
    const filtered = filterUnstableSections(changes, history);
    expect(hasRecentRemoved(filtered)).toBe(true);
  });

  it("suppresses a flickering remove: absent in the prior window at some point", () => {
    const changes = diffHomepages(parse(WITH), parse(WITHOUT));
    // history[1] = WITH (matches the diff's prev), but history[2] = WITHOUT —
    // the section flickered out, so it's not confirmed present throughout.
    const history = [WITHOUT, WITH, WITHOUT, WITH].map(parse);
    const filtered = filterUnstableSections(changes, history);
    expect(hasRecentRemoved(filtered)).toBe(false);
  });

  it("keeps a genuine add on short history (only [0] and [1] available)", () => {
    const changes = diffHomepages(parse(WITHOUT), parse(WITH));
    // Only the current structure and the diff's own prev are available — no
    // flicker evidence is possible, and the sole prior structure already lacks
    // the heading, so the add is confirmed.
    const history = [WITH, WITHOUT].map(parse);
    const filtered = filterUnstableSections(changes, history);
    expect(hasRecentAdded(filtered)).toBe(true);
  });

  it("leaves non-section changes untouched", () => {
    const afterHtml = WITHOUT.replace("Ship faster with Acme", "AI project intelligence");
    const changes = diffHomepages(parse(WITHOUT), parse(afterHtml));
    const history = [afterHtml, WITHOUT].map(parse);
    const filtered = filterUnstableSections(changes, history);
    expect(filtered.some((c) => c.kind === "hero_headline_changed")).toBe(true);
  });
});
