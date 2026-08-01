import type { ChangelogItemType, ContentItemInput } from "./types";

/**
 * Type a changelog entry WITHOUT a model (Content Intelligence v2 P1).
 *
 * This runs before the batched typer and is the reason the feature is cheap and,
 * more importantly, the reason it is safe: every entry type that goes on to emit
 * a signal — `breaking`, `deprecation`, `security`, `fix` — is decided here, by
 * keywords, in code. What the model is left to judge is `feature` vs
 * `improvement`, and neither of those alerts anyone.
 *
 * EN + FR + DE, because a competitor's release notes are written in their own
 * language and a German changelog announcing a breaking change is exactly the one
 * a user would not read for themselves.
 *
 * The order is a precedence, not a list: release notes say "fixes a breaking
 * change in the deprecated auth endpoint" in one line, and the loudest true
 * statement about that line is that something breaks.
 *
 * PURE: no I/O, no DB, no AI.
 */

interface Rule {
  type: ChangelogItemType;
  patterns: RegExp[];
}

// Anchored on words a release note uses about ITSELF. Loose matching here is not
// a missed nuance — it is a `breaking` label, which sends an alert.
const RULES: Rule[] = [
  {
    type: "breaking",
    patterns: [
      /\bbreaking[\s-]?changes?\b/i,
      /\bbreaking\b(?=.{0,40}\b(?:change|update|release|api)\b)/i,
      /\bbackwards?[\s-]incompatible\b/i,
      /\bincompatible[\s-]changes?\b/i,
      /\bmigration required\b/i,
      // FR
      /\bchangements? (?:cassants?|incompatibles?|de rupture)\b/i,
      /\brupture de compatibilit[ée]\b/i,
      // DE
      /\bbreaking[\s-]?[äa]nderung(?:en)?\b/i,
      /\bnicht[\s-]abw[äa]rtskompatibel\b/i,
      /\binkompatible [ÄA]nderung(?:en)?\b/i,
    ],
  },
  {
    type: "deprecation",
    patterns: [
      /\bdeprecat\w*/i,
      /\bsunset(?:ting|ted)?\b/i,
      /\bend[\s-]of[\s-]life\b/i,
      /\bEOL\b/,
      /\bno longer supported\b/i,
      // FR
      /\bd[ée]pr[ée]ci\w*/i,
      /\bobsol[èe]t\w*/i,
      /\bfin de (?:vie|support)\b/i,
      // DE
      /\bveraltet\b/i,
      /\babgek[üu]ndigt\b/i,
      /\bnicht mehr unterst[üu]tzt\b/i,
    ],
  },
  {
    type: "security",
    patterns: [
      /\bCVE-\d{4}-\d{4,}\b/i,
      /\bsecurity (?:fix|patch|update|advisory|release|issue)\b/i,
      /\bvulnerabilit\w*/i,
      /\bXSS\b|\bCSRF\b|\bSSRF\b|\bRCE\b/,
      // FR
      /\b(?:faille|correctif|mise à jour) de s[ée]curit[ée]\b/i,
      /\bvuln[ée]rabilit[ée]s?\b/i,
      // DE
      /\bsicherheits(?:update|fix|patch|l[üu]cke|hinweis)\b/i,
    ],
  },
  {
    type: "fix",
    patterns: [
      /\b(?:bug)?fix(?:e[sd])?\b/i,
      /\bhotfix\b/i,
      /\bpatch(?:e[sd])?\b/i,
      /\bresolved? an? (?:issue|bug|regression)\b/i,
      /\bregression\b/i,
      // FR
      /\bcorrectifs?\b/i,
      /\bcorrig[ée]\w*/i,
      /\bcorrection de bug\b/i,
      // DE
      /\bfehlerbehebung(?:en)?\b/i,
      /\bbehoben\b/i,
      /\bfehler\b/i,
    ],
  },
];

/**
 * The type this entry states about itself, or null when it states nothing loud.
 *
 * `null` is not a failure — it is most entries, and it is what the batched typer
 * is handed. Reads the title and, when the feed carried one, the body: a release
 * note titled "v4.2.0" says nothing, and everything it does say is below.
 */
export function typeChangelogEntry(item: {
  title: string;
  body?: string | null;
}): ChangelogItemType | null {
  const text = [item.title, item.body ?? ""].join("\n");
  if (!text.trim()) return null;
  for (const rule of RULES) {
    if (rule.patterns.some((p) => p.test(text))) return rule.type;
  }
  return null;
}

/**
 * Split a batch into the entries the keywords settled and the ones a model still
 * has to look at. The caller pays for the second list only.
 */
export function partitionByHeuristic(items: ReadonlyArray<ContentItemInput>): {
  typed: Array<{ item: ContentItemInput; itemType: ChangelogItemType }>;
  untyped: ContentItemInput[];
} {
  const typed: Array<{ item: ContentItemInput; itemType: ChangelogItemType }> = [];
  const untyped: ContentItemInput[] = [];
  for (const item of items) {
    const itemType = typeChangelogEntry(item);
    if (itemType) typed.push({ item, itemType });
    else untyped.push(item);
  }
  return { typed, untyped };
}
