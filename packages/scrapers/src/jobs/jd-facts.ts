/**
 * Job-description fact mining: the DETERMINISTIC half (Hiring Intelligence v2 P1).
 *
 * The model reads a batch of JDs and proposes facts. Everything that decides
 * whether a proposed fact SURVIVES lives here, in code, not in the prompt:
 *
 *  1. `isVerbatim` — the evidence snippet must be a substring of the JD it came
 *     from. A fact whose sentence isn't in the text is an invention, and no
 *     amount of prompt wording makes that check reliable. This is the single
 *     guard that makes the feature safe to ship.
 *  2. `hasNoveltyPhrase` — a `product_hint` is only retained when the JD actually
 *     says something is new ("you'll build", "0 to 1", "greenfield", "nouvelle
 *     équipe", "von Grund auf"). Without it, "help us scale our platform" reads
 *     to a model as an unannounced initiative, and every maintenance role becomes
 *     a product leak.
 *  3. `MAX_FACTS_PER_POSTING` — a JD is a page of prose; a model asked for facts
 *     will happily return twenty. Five is what a reader can act on.
 *
 * PURE: no I/O, no DB, no AI. Exposed as `@outrival/scrapers/jobs-jd-facts`.
 */

/** Kinds a mined fact may carry. Anything else the model returns is dropped. */
export const POSTING_FACT_KINDS = ["tech", "product_hint", "team_size", "market", "language"] as const;
export type PostingFactKind = (typeof POSTING_FACT_KINDS)[number];

/** At most this many facts survive per posting, highest confidence first. */
export const MAX_FACTS_PER_POSTING = 5;

/** JD bodies are stored capped: a 15k window holds a long JD whole. */
export const MAX_DESCRIPTION_CHARS = 15_000;

/**
 * Only these buckets are mined. Sales/marketing/support JDs are boilerplate about
 * quota and CRM tools — they carry no stack and no unannounced product, so paying
 * a model to read them is pure cost.
 */
export const MINED_BUCKETS = ["engineering", "product", "data_ml"] as const;

export interface RawFact {
  kind: string;
  value: string;
  evidenceSnippet: string;
  confidence?: number | null;
}

export interface MinedFact {
  kind: PostingFactKind;
  value: string;
  /** Lowercased, whitespace-collapsed value — the corroboration key. */
  valueKey: string;
  evidenceSnippet: string;
  confidence: number | null;
}

/**
 * Whitespace-collapsed, lowercased text for substring comparison.
 *
 * "Exact substring" is checked on this normalised form rather than the raw bytes:
 * a model re-wraps a sentence that spans two lines of the JD and changes nothing
 * about what it says, so comparing raw would drop true evidence over a newline.
 * Punctuation and every word are still compared exactly, which is what the guard
 * is actually about.
 */
export function normalizeForMatch(text: string): string {
  return text.replace(/\s+/g, " ").trim().toLowerCase();
}

/** Is `snippet` genuinely present in `jd`? Empty/very short snippets never pass. */
export function isVerbatim(snippet: string, jd: string): boolean {
  const needle = normalizeForMatch(snippet);
  // A three-word "snippet" would match almost any JD, so it proves nothing.
  if (needle.length < 12) return false;
  return normalizeForMatch(jd).includes(needle);
}

/**
 * Novelty vocabulary, EN + FR + DE. A JD that says none of this is describing a
 * seat on an existing team, whatever a model reads into the responsibilities.
 * Word-boundary anchored so "first" doesn't fire on "firstly" being absent —
 * it fires on "first" the adjective, which is what a launch reads like.
 */
const NOVELTY_PATTERNS: RegExp[] = [
  // EN
  /\bnew (team|product|line|business unit|division|offering|platform|vertical)\b/i,
  /\byou(?:'|’)?ll (build|create|launch|design|define|establish|stand up)\b/i,
  /\byou will (build|create|launch|design|define|establish|stand up)\b/i,
  /\bfrom scratch\b/i,
  /\b0\s*(?:to|→|-)\s*1\b/i,
  /\bzero to one\b/i,
  /\bgreenfield\b/i,
  /\bground[- ]up\b/i,
  /\bupcoming (launch|product|release|offering)\b/i,
  /\bwe(?:'|’)?re (building|launching|standing up|spinning up)\b/i,
  /\bwe are (building|launching|standing up|spinning up)\b/i,
  /\b(first|founding) (engineer|hire|member|product manager|designer)\b/i,
  /\bnewly (formed|created|established)\b/i,
  /\bearly stage(?:s)? of\b/i,
  // FR
  /\bnouvelle (équipe|offre|gamme|division|plateforme)\b/i,
  /\bnouveau (produit|pôle|département)\b/i,
  /\bde zéro\b/i,
  /\bpartir de zéro\b/i,
  /\bvous (construirez|créerez|lancerez|définirez)\b/i,
  /\bnous (construisons|lançons|créons) (un|une|notre)\b/i,
  /\bpremier (ingénieur|recrutement|membre)\b/i,
  // DE
  /\bneue[sr]? (Team|Produkt|Geschäftsbereich|Plattform|Abteilung)\b/i,
  /\bvon Grund auf\b/i,
  /\bbei null\b/i,
  /\bdu wirst .{0,40}(aufbauen|entwickeln|gestalten)\b/i,
  /\bwir (bauen|starten|entwickeln) (ein|eine|unser)\b/i,
  /\berste[rn]? (Ingenieur|Mitarbeiter|Entwickler)\b/i,
];

/**
 * Does this JD claim something is NEW? The pre-filter for `product_hint`: no
 * novelty phrase in the text ⇒ no hint is retained, whatever the model proposed.
 */
export function hasNoveltyPhrase(jd: string): boolean {
  return NOVELTY_PATTERNS.some((re) => re.test(jd));
}

function isFactKind(k: string): k is PostingFactKind {
  return (POSTING_FACT_KINDS as readonly string[]).includes(k);
}

/**
 * Apply every deterministic guard to one posting's proposed facts.
 *
 * Order matters only for the cap: the survivors are ranked by the model's own
 * confidence so the five that make it are the five it was surest of. Nothing
 * here trusts that confidence as a THRESHOLD — a fact is kept or dropped by the
 * evidence, never by a score.
 */
export function applyFactGuards(jd: string, raw: ReadonlyArray<RawFact>): MinedFact[] {
  const novelty = hasNoveltyPhrase(jd);
  const seen = new Set<string>();
  const kept: MinedFact[] = [];

  for (const f of raw) {
    const kind = (f.kind ?? "").trim().toLowerCase();
    if (!isFactKind(kind)) continue;
    // Guard (b): an unannounced-initiative claim over a JD that never says
    // anything is new is the model reading ambition into a maintenance role.
    if (kind === "product_hint" && !novelty) continue;

    const value = (f.value ?? "").trim();
    if (!value || value.length > 120) continue;
    // Guard (a): the sentence must be IN the job description.
    const snippet = (f.evidenceSnippet ?? "").trim();
    if (!isVerbatim(snippet, jd)) continue;

    const valueKey = normalizeForMatch(value);
    const dedupKey = `${kind}::${valueKey}`;
    if (seen.has(dedupKey)) continue;
    seen.add(dedupKey);

    const confidence =
      typeof f.confidence === "number" && Number.isFinite(f.confidence)
        ? Math.min(1, Math.max(0, f.confidence))
        : null;
    kept.push({ kind, value, valueKey, evidenceSnippet: snippet, confidence });
  }

  // Guard (c): cap, most-confident first (unscored facts sort last).
  kept.sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0));
  return kept.slice(0, MAX_FACTS_PER_POSTING);
}

export type RemoteMode = "remote" | "hybrid" | "onsite";

const HYBRID_RE =
  /\bhybrid(?:e)?\b|\bhybride\b|\b\d\s*days?\s+(?:a|per)\s+week\s+in\s+(?:the\s+)?office\b|\bpartially remote\b|\bteilweise remote\b/i;
const REMOTE_RE =
  /\b(?:fully|100%|entirely)?\s*remote\b|\bwork from (?:home|anywhere)\b|\btélétravail\b|\bhome[- ]office\b|\bdistributed team\b/i;
const ONSITE_RE =
  /\bon[- ]?site\b|\bin[- ]office\b|\bin person\b|\bsur site\b|\bprésentiel\b|\bvor Ort\b|\bno remote\b/i;

/**
 * Resolve a posting's working mode from what the board actually printed.
 *
 * Hybrid is tested FIRST because "hybrid — 2 days remote" contains the word
 * remote, and reading that as fully remote would invert the fact. Nothing is
 * inferred from silence: a JD that never states a mode returns null, because
 * defaulting to "onsite" would manufacture an RTO shift the day the wording
 * changes.
 */
export function detectRemoteMode(
  location: string | null | undefined,
  description: string | null | undefined,
): RemoteMode | null {
  // The location field is the board's own answer to this question; the JD body is
  // the fallback, and it is noisier (it may mention the office of another team).
  for (const text of [location ?? "", description ?? ""]) {
    if (!text.trim()) continue;
    if (HYBRID_RE.test(text)) return "hybrid";
    if (REMOTE_RE.test(text)) return "remote";
    if (ONSITE_RE.test(text)) return "onsite";
  }
  return null;
}

/**
 * Strip an HTML JD body to plain text and cap it.
 *
 * ATS bodies are small, self-contained HTML fragments (`<p>`, `<ul>`, `<strong>`)
 * — never a full page — so a tag strip is honest here and keeps the scrapers
 * package free of cheerio. Block-level tags become newlines so the sentence
 * boundaries a snippet is quoted from survive.
 */
export function htmlToPlainJd(input: string): string {
  return input
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<\/(p|div|li|ul|ol|h[1-6]|tr|section)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#(\d+);/g, (_m, d: string) => String.fromCharCode(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_m, h: string) => String.fromCharCode(Number.parseInt(h, 16)))
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]*\n[ \t]*/g, "\n")
    .trim()
    .slice(0, MAX_DESCRIPTION_CHARS);
}
