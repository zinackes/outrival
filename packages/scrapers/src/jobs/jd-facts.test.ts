import { test, expect } from "bun:test";
import {
  applyFactGuards,
  detectRemoteMode,
  hasNoveltyPhrase,
  htmlToPlainJd,
  isVerbatim,
  MAX_FACTS_PER_POSTING,
  normalizeForMatch,
} from "./jd-facts";

const JD = `Senior Platform Engineer

We are building a new billing platform from scratch to replace our legacy system.
You will operate our services on Kubernetes across three regions and own the
migration of our analytics warehouse to Snowflake.

Requirements: 5+ years of backend experience. German is required for this role
because we are expanding into Germany this year.`;

// ─── substring check (guard a) ───────────────────────────────────────────────

test("isVerbatim: accepts a sentence copied from the description", () => {
  expect(isVerbatim("You will operate our services on Kubernetes across three regions", JD)).toBe(
    true,
  );
});

test("isVerbatim: tolerates re-wrapped whitespace, since the words are unchanged", () => {
  // The JD wraps this sentence across two lines; a model returns it as one.
  expect(
    isVerbatim("own the migration of our analytics warehouse to Snowflake", JD),
  ).toBe(true);
});

test("isVerbatim: rejects a paraphrase", () => {
  expect(isVerbatim("The team runs its workloads on Kubernetes in three regions", JD)).toBe(false);
});

test("isVerbatim: rejects a snippet too short to prove anything", () => {
  expect(isVerbatim("Kubernetes", JD)).toBe(false);
});

test("normalizeForMatch: collapses whitespace and lowercases", () => {
  expect(normalizeForMatch("  A\n  B\tC ")).toBe("a b c");
});

// ─── novelty pre-filter (guard b) ────────────────────────────────────────────

test("hasNoveltyPhrase: fires on an explicit build-from-scratch statement", () => {
  expect(hasNoveltyPhrase(JD)).toBe(true);
});

test("hasNoveltyPhrase: does not fire on growth/ambition boilerplate", () => {
  expect(
    hasNoveltyPhrase(
      "Help us scale our platform to millions of users and improve our infrastructure.",
    ),
  ).toBe(false);
});

test("hasNoveltyPhrase: French and German novelty wording", () => {
  expect(hasNoveltyPhrase("Vous rejoindrez une nouvelle équipe produit à Paris.")).toBe(true);
  expect(hasNoveltyPhrase("Wir bauen ein neues Produkt von Grund auf.")).toBe(true);
});

// ─── applyFactGuards ─────────────────────────────────────────────────────────

test("applyFactGuards: keeps a sourced fact, drops one whose snippet is invented", () => {
  const kept = applyFactGuards(JD, [
    {
      kind: "tech",
      value: "Kubernetes",
      evidenceSnippet: "You will operate our services on Kubernetes across three regions",
      confidence: 0.9,
    },
    {
      kind: "tech",
      value: "Kafka",
      evidenceSnippet: "We stream every event through Kafka in production",
      confidence: 0.95,
    },
  ]);
  expect(kept.map((f) => f.value)).toEqual(["Kubernetes"]);
  expect(kept[0]!.valueKey).toBe("kubernetes");
});

test("applyFactGuards: a product_hint is blocked when the JD claims nothing is new", () => {
  const maintenance =
    "You will maintain our existing billing platform and improve its reliability over time.";
  const kept = applyFactGuards(maintenance, [
    {
      kind: "product_hint",
      value: "billing platform rebuild",
      evidenceSnippet: "You will maintain our existing billing platform and improve its reliability",
      confidence: 0.8,
    },
  ]);
  expect(kept).toEqual([]);
});

test("applyFactGuards: the same product_hint passes when the JD says it is new", () => {
  const kept = applyFactGuards(JD, [
    {
      kind: "product_hint",
      value: "new billing platform",
      evidenceSnippet: "We are building a new billing platform from scratch to replace our legacy",
      confidence: 0.8,
    },
  ]);
  expect(kept).toHaveLength(1);
  expect(kept[0]!.kind).toBe("product_hint");
});

test("applyFactGuards: caps at five facts, most confident first", () => {
  const snippet = "You will operate our services on Kubernetes across three regions";
  const raw = Array.from({ length: 8 }, (_, i) => ({
    kind: "tech",
    value: `Tech ${i}`,
    evidenceSnippet: snippet,
    confidence: i / 10,
  }));
  const kept = applyFactGuards(JD, raw);
  expect(kept).toHaveLength(MAX_FACTS_PER_POSTING);
  expect(kept[0]!.value).toBe("Tech 7");
});

test("applyFactGuards: drops unknown kinds and duplicate values", () => {
  const snippet = "You will operate our services on Kubernetes across three regions";
  const kept = applyFactGuards(JD, [
    { kind: "salary", value: "120k", evidenceSnippet: snippet },
    { kind: "tech", value: "Kubernetes", evidenceSnippet: snippet },
    { kind: "tech", value: "kubernetes", evidenceSnippet: snippet },
  ]);
  expect(kept).toHaveLength(1);
});

// ─── remote mode ─────────────────────────────────────────────────────────────

test("detectRemoteMode: hybrid wins over the word 'remote' inside it", () => {
  expect(detectRemoteMode("Hybrid — 2 days remote", null)).toBe("hybrid");
});

test("detectRemoteMode: fully remote, on-site, and silence", () => {
  expect(detectRemoteMode("Remote (EU)", null)).toBe("remote");
  expect(detectRemoteMode("Paris, on-site", null)).toBe("onsite");
  expect(detectRemoteMode("Paris", null)).toBeNull();
});

test("detectRemoteMode: falls back to the description when the location is silent", () => {
  expect(detectRemoteMode("Berlin", "This role is fully remote within Europe.")).toBe("remote");
});

// ─── html → plain ────────────────────────────────────────────────────────────

test("htmlToPlainJd: strips markup, decodes entities, keeps block boundaries", () => {
  const out = htmlToPlainJd("<p>We use <strong>Rust</strong> &amp; Go.</p><ul><li>Item</li></ul>");
  expect(out).toBe("We use Rust & Go.\nItem");
});

test("htmlToPlainJd: plain text passes through unchanged", () => {
  expect(htmlToPlainJd("Plain description text.")).toBe("Plain description text.");
});
