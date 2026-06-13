import { and, desc, eq, gte, isNull, ne } from "drizzle-orm";
import { competitors, signals } from "@outrival/db";
import { db } from "../db";

// Ask Outrival starter suggestions — deterministic, AI-free. A small catalogue of
// question templates is filled with the org's real, currently-active entities (the
// competitors whose signals moved most in the last 30 days), then a daily org-seeded
// PRNG shuffles the eligible templates and rotates which competitor fills each slot.
// Same org + same day => identical suggestions (stable within the day, no re-render
// flicker); next day => a fresh set. No model call, no rate limit — two cheap reads.

export interface AskSuggestion {
  q: string;
  // Maps to an icon + category tint on the client (KIND_META in ask-panel.tsx).
  kind: "activity" | "pricing" | "hiring" | "reviews" | "product" | "compare";
}

const WINDOW_DAYS = 30;
const COUNT = 4;
// Most-active competitors a slot may rotate through: keeps suggestions about what is
// actually moving while still varying which name appears day to day.
const ROTATE_POOL = 3;

// Shown verbatim to brand-new orgs (no competitors yet). Mirrors the client defaults.
const FALLBACK: AskSuggestion[] = [
  { q: "What changed across my competitors this month?", kind: "activity" },
  { q: "Who is hiring the most right now?", kind: "hiring" },
  { q: "How has competitor pricing shifted this quarter?", kind: "pricing" },
  { q: "What are the most common complaints in competitor reviews?", kind: "reviews" },
];

// --- deterministic PRNG (mulberry32) seeded from a string -------------------------
function hashSeed(s: string): number {
  let h = 1779033703 ^ s.length;
  for (let i = 0; i < s.length; i++) {
    h = Math.imul(h ^ s.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return h >>> 0;
}
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function shuffle<T>(arr: readonly T[], rng: () => number): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = a[i]!;
    a[i] = a[j]!;
    a[j] = tmp;
  }
  return a;
}
function pick<T>(arr: readonly T[], rng: () => number): T {
  return arr[Math.floor(rng() * arr.length)]!;
}

// --- org context (two cheap, org-scoped reads) ------------------------------------
interface Ctx {
  // Competitors ranked: most recent-signal volume first, the rest of the roster after,
  // so a slot always has a name to fill even before any signal lands.
  ranked: { id: string; name: string }[];
  cats: Set<string>; // signal categories with ≥1 hit in the window (data-exists proxy)
  highSignal?: { name: string; severity: "high" | "critical" };
  rng: () => number;
}

async function loadCtx(orgId: string): Promise<Ctx | null> {
  const roster = await db
    .select({ id: competitors.id, name: competitors.name })
    .from(competitors)
    .where(
      and(
        eq(competitors.orgId, orgId),
        isNull(competitors.deletedAt),
        ne(competitors.type, "self"),
      ),
    );
  if (roster.length === 0) return null;

  const since = new Date(Date.now() - WINDOW_DAYS * 86_400_000);
  const recent = await db
    .select({
      competitorId: signals.competitorId,
      category: signals.category,
      severity: signals.severity,
    })
    .from(signals)
    .where(and(eq(signals.orgId, orgId), gte(signals.createdAt, since)))
    .orderBy(desc(signals.createdAt))
    .limit(200);

  const byId = new Map(roster.map((r) => [r.id, r.name]));
  const count = new Map<string, number>();
  const cats = new Set<string>();
  let highSignal: Ctx["highSignal"];
  for (const s of recent) {
    const name = byId.get(s.competitorId);
    if (!name) continue; // foreign/deleted safety
    count.set(s.competitorId, (count.get(s.competitorId) ?? 0) + 1);
    cats.add(s.category);
    if (!highSignal && (s.severity === "critical" || s.severity === "high")) {
      highSignal = { name, severity: s.severity };
    }
  }
  const ranked = [...roster].sort((a, b) => (count.get(b.id) ?? 0) - (count.get(a.id) ?? 0));

  const epochDay = Math.floor(Date.now() / 86_400_000);
  return { ranked, cats, highSignal, rng: mulberry32(hashSeed(`${orgId}:${epochDay}`)) };
}

// Rotate through the most-active competitors, preferring one not already used in this
// set so the four starters spread across the account rather than fixate on one name.
function pickCompetitor(ctx: Ctx, used: Set<string>): string | null {
  const pool = ctx.ranked.slice(0, ROTATE_POOL).map((r) => r.name);
  const choices = pool.filter((n) => !used.has(n));
  const from = choices.length ? choices : pool;
  if (from.length === 0) return null;
  const name = pick(from, ctx.rng);
  used.add(name);
  return name;
}

function pickTwo(ctx: Ctx, used: Set<string>): [string, string] | null {
  if (ctx.ranked.length < 2) return null;
  const pool = shuffle(
    ctx.ranked.slice(0, Math.max(ROTATE_POOL + 1, 4)).map((r) => r.name),
    ctx.rng,
  );
  const a = pool[0]!;
  const b = pool[1]!;
  used.add(a);
  used.add(b);
  return [a, b];
}

const PERIODS = ["week", "month"] as const;

interface Template {
  id: string;
  kind: AskSuggestion["kind"];
  // Returns the filled question, or null when the org/day can't satisfy it.
  build: (ctx: Ctx, used: Set<string>) => string | null;
}

const TEMPLATES: Template[] = [
  {
    id: "activity-all",
    kind: "activity",
    build: (ctx) => `What changed across my competitors this ${pick(PERIODS, ctx.rng)}?`,
  },
  {
    id: "activity-one",
    kind: "activity",
    build: (ctx, used) => {
      const c = pickCompetitor(ctx, used);
      return c ? `What's new at ${c} this ${pick(PERIODS, ctx.rng)}?` : null;
    },
  },
  {
    id: "why-signal",
    kind: "activity",
    build: (ctx) =>
      ctx.highSignal
        ? `What's behind the ${ctx.highSignal.severity}-severity signal on ${ctx.highSignal.name}?`
        : null,
  },
  {
    id: "hiring-all",
    kind: "hiring",
    build: () => "Who is hiring the most right now?",
  },
  {
    id: "hiring-one",
    kind: "hiring",
    build: (ctx, used) => {
      if (!ctx.cats.has("hiring")) return null;
      const c = pickCompetitor(ctx, used);
      return c ? `How is ${c}'s hiring changing?` : null;
    },
  },
  {
    id: "pricing-one",
    kind: "pricing",
    build: (ctx, used) => {
      if (!ctx.cats.has("pricing")) return null;
      const c = pickCompetitor(ctx, used);
      return c ? `What changed in ${c}'s pricing recently?` : null;
    },
  },
  {
    id: "reviews-one",
    kind: "reviews",
    build: (ctx, used) => {
      if (!ctx.cats.has("reviews")) return null;
      const c = pickCompetitor(ctx, used);
      return c ? `What are the top complaints about ${c}?` : null;
    },
  },
  {
    id: "product-one",
    kind: "product",
    build: (ctx, used) => {
      if (!ctx.cats.has("product")) return null;
      const c = pickCompetitor(ctx, used);
      return c ? `Summarize ${c}'s recent product moves` : null;
    },
  },
  {
    id: "compare",
    kind: "compare",
    build: (ctx, used) => {
      const pair = pickTwo(ctx, used);
      return pair ? `How does ${pair[0]} compare to ${pair[1]}?` : null;
    },
  },
];

export async function buildAskSuggestions(orgId: string): Promise<AskSuggestion[]> {
  const ctx = await loadCtx(orgId);
  if (!ctx) return FALLBACK;

  const used = new Set<string>();
  const out: AskSuggestion[] = [];
  const seenIds = new Set<string>();
  for (const t of shuffle(TEMPLATES, ctx.rng)) {
    if (out.length >= COUNT) break;
    if (seenIds.has(t.id)) continue;
    const q = t.build(ctx, used);
    if (!q) continue;
    seenIds.add(t.id);
    out.push({ q, kind: t.kind });
  }

  // Top up from the static set if the org couldn't fill four (tiny / signal-less orgs).
  for (const f of FALLBACK) {
    if (out.length >= COUNT) break;
    if (!out.some((o) => o.q === f.q)) out.push(f);
  }
  return out.slice(0, COUNT);
}
