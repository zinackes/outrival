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

describe("filterUnstableSections — flaky lazy section", () => {
  it("suppresses section_added when the section flickers across the window", () => {
    // A single 2-snapshot diff sees the section as newly added…
    const changes = diffHomepages(parse(WITHOUT), parse(WITH));
    expect(hasRecentAdded(changes)).toBe(true);

    // …but over the window it's present/absent alternately (never stable), so the
    // add is dropped.
    const history = [WITH, WITHOUT, WITH, WITHOUT, WITH, WITHOUT].map(parse);
    const filtered = filterUnstableSections(changes, history);
    expect(hasRecentAdded(filtered)).toBe(false);
  });

  it("keeps section_added when the section is stably present", () => {
    const changes = diffHomepages(parse(WITHOUT), parse(WITH));
    const history = [WITH, WITH, WITH, WITHOUT, WITHOUT, WITHOUT].map(parse);
    const filtered = filterUnstableSections(changes, history);
    expect(hasRecentAdded(filtered)).toBe(true);
  });

  it("drops add/remove with insufficient history (can't confirm stability)", () => {
    const changes = diffHomepages(parse(WITHOUT), parse(WITH));
    const filtered = filterUnstableSections(changes, [WITH, WITHOUT].map(parse));
    expect(hasRecentAdded(filtered)).toBe(false);
  });

  it("leaves non-section changes untouched", () => {
    const afterHtml = WITHOUT.replace("Ship faster with Acme", "AI project intelligence");
    const changes = diffHomepages(parse(WITHOUT), parse(afterHtml));
    const history = [afterHtml, WITHOUT].map(parse);
    const filtered = filterUnstableSections(changes, history);
    expect(filtered.some((c) => c.kind === "hero_headline_changed")).toBe(true);
  });

  it("tolerates pre-patch null structures in the window without faking a removal", () => {
    // prev has the section, curr dropped it → 2-snapshot diff sees a removal…
    const changes = diffHomepages(parse(WITH), parse(WITHOUT));
    expect(changes.some((c) => c.kind === "section_removed")).toBe(true);
    // …but a null (pre-patch) snapshot in the prior window means "not present in
    // EVERY prior", so the removal is not confirmed.
    const history = [WITHOUT, WITHOUT, WITHOUT, WITH, null, WITH].map((h) =>
      h === null ? null : parse(h),
    );
    const filtered = filterUnstableSections(changes, history);
    expect(filtered.some((c) => c.kind === "section_removed")).toBe(false);
  });
});
