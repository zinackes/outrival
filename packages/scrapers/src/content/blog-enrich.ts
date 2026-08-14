import { isVerbatim } from "../jobs/jd-facts";
import { namesBrand } from "./named-you";

/**
 * The DETERMINISTIC half of blog enrichment (Content Intelligence v2 P2).
 *
 * A model reads a batch of posts and proposes what each one is about. Everything
 * that decides what SURVIVES lives here, in code, for the same reason it does in
 * `jobs/jd-facts`: the guard is the reason the feature is safe to ship, and a
 * guard written into a prompt is a request, not a check.
 *
 * The one that matters is the competitor mention, because it is what can raise a
 * `critical` alert. A named competitor is kept only when the post WRITES that name
 * (at word boundaries, so "Slackline" is not Slack) and when the quoted sentence is
 * genuinely in the text. A model that summarises "they compare themselves to the
 * usual suspects" into a list of four vendors gets none of them through.
 *
 * PURE: no I/O, no DB, no AI.
 */

/** What a post IS. Chosen by the model; none of these raises an alert on its own. */
export const BLOG_ITEM_TYPES = [
  "feature_announcement",
  "case_study",
  "thought_leadership",
  "seo",
  "tutorial",
  "company_news",
] as const;
export type BlogItemType = (typeof BLOG_ITEM_TYPES)[number];

/** Facets kept per post. Past this it is a tag cloud, not a reading. */
const MAX_FACET_VALUES = 5;
/** A facet value is a phrase, not a paragraph. */
const MAX_FACET_CHARS = 60;
/** Summaries are one or two lines by contract; this is the guard, not the intent. */
const MAX_SUMMARY_CHARS = 400;

/**
 * What a post says the named company IS to the publisher.
 *
 * The extraction has always asked for "other companies the post names", which is a
 * question about PRESENCE. Presence is not rivalry: a launch post names the
 * customers running on it, the chips it runs on and the registries it syncs with,
 * and filing those as competitors is what put Priceline and Spotify on a market map
 * for a container registry. Only `competitor` is a positioning fact.
 *
 * `other` is the landing place for anything unclassified, INCLUDING a model that
 * omits the field: an unclassified mention must never be able to enter the map.
 */
export const MENTION_RELATIONSHIPS = ["competitor", "customer", "partner", "other"] as const;
export type MentionRelationship = (typeof MENTION_RELATIONSHIPS)[number];

export interface RawMention {
  name: string;
  snippet?: string | null;
  relationship?: string | null;
}

export interface RawBlogEnrichment {
  itemType?: string | null;
  topics?: unknown;
  products?: unknown;
  personas?: unknown;
  competitorsNamed?: ReadonlyArray<RawMention> | null;
  summary?: string | null;
}

/** One company the post names, with the sentence that names it. */
export interface KeptMention {
  /** As the post writes it. */
  name: string;
  /** Verbatim from the post — substring-verified before it got here. */
  snippet: string;
  /** What the post makes them to the publisher. Only `competitor` is a rival. */
  relationship: MentionRelationship;
}

export interface BlogEnrichment {
  itemType: BlogItemType | null;
  topics: string[];
  products: string[];
  personas: string[];
  mentions: KeptMention[];
  summary: string | null;
}

export function isBlogItemType(value: string): value is BlogItemType {
  return (BLOG_ITEM_TYPES as readonly string[]).includes(value);
}

/**
 * The model's label, or `other`.
 *
 * Unrecognised and absent both fall to `other` on purpose, and the direction of that
 * default is the whole guard: an unclassified mention leaves the market map quieter,
 * where a mention defaulted to `competitor` would put a customer back on it.
 */
function relationshipOf(value: string | null | undefined): MentionRelationship {
  const label = (value ?? "").trim().toLowerCase();
  return (MENTION_RELATIONSHIPS as readonly string[]).includes(label)
    ? (label as MentionRelationship)
    : "other";
}

/** The mentions that are a positioning fact — the only ones the market map takes. */
export function rivalMentions(mentions: ReadonlyArray<KeptMention>): KeptMention[] {
  return mentions.filter((m) => m.relationship === "competitor");
}

/** Trim, drop the empty and the overlong, dedupe, cap. `lower` for topics only. */
function facet(raw: unknown, lower: boolean): string[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const entry of raw) {
    if (typeof entry !== "string") continue;
    const value = entry.replace(/\s+/g, " ").trim();
    if (!value || value.length > MAX_FACET_CHARS) continue;
    const normalized = lower ? value.toLowerCase() : value;
    if (seen.has(normalized.toLowerCase())) continue;
    seen.add(normalized.toLowerCase());
    out.push(normalized);
    if (out.length >= MAX_FACET_VALUES) break;
  }
  return out;
}

/**
 * Apply every deterministic guard to one post's proposed enrichment.
 *
 * `postText` is the article we fetched — the only thing a claim about this post is
 * allowed to be checked against.
 */
export function applyBlogGuards(postText: string, raw: RawBlogEnrichment): BlogEnrichment {
  const itemTypeRaw = (raw.itemType ?? "").trim().toLowerCase();

  const mentions: KeptMention[] = [];
  const seen = new Set<string>();
  for (const mention of raw.competitorsNamed ?? []) {
    const name = (mention?.name ?? "").replace(/\s+/g, " ").trim();
    if (!name || name.length > MAX_FACET_CHARS) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    // The post has to write the name, as a word. A model that infers "they are
    // positioning against the incumbents" names nobody, whatever it returns.
    if (!namesBrand(postText, name)) continue;
    // And it has to be able to show the sentence. Same rule posting_facts applies:
    // a claim with no quotable source does not exist.
    const snippet = (mention?.snippet ?? "").trim();
    if (!isVerbatim(snippet, postText)) continue;
    seen.add(key);
    mentions.push({ name, snippet, relationship: relationshipOf(mention?.relationship) });
    if (mentions.length >= MAX_FACET_VALUES) break;
  }

  const summary = (raw.summary ?? "").replace(/\s+/g, " ").trim();
  return {
    itemType: isBlogItemType(itemTypeRaw) ? itemTypeRaw : null,
    topics: facet(raw.topics, true),
    products: facet(raw.products, false),
    personas: facet(raw.personas, false),
    mentions,
    summary: summary ? summary.slice(0, MAX_SUMMARY_CHARS) : null,
  };
}
