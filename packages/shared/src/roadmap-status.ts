/**
 * Canonical roadmap-status vocabulary (Content Intelligence v2 P5).
 *
 * A public roadmap portal names its own columns. Canny ships with "Under Review /
 * Planned / In Progress / Complete / Closed" and every team renames them: "Up next",
 * "Shipping soon", "En cours", "In Bearbeitung", "Won't do". The status LABEL is
 * what a reader recognises, so it is stored verbatim; this file is what a QUERY can
 * group on, because "how much have they delivered this quarter" cannot be answered
 * by matching free text across forty portals that each spell delivery differently.
 *
 * Same shape as `industry-catalog` and `entitlement-catalog`: data, a pure resolver,
 * zero AI. Two rules carry the safety:
 *
 *  - AN UNKNOWN LABEL IS `other`, NEVER A GUESS. `planned` and `in_progress` are the
 *    two states that raise a signal, so a loose read is not a mislabelled row, it is
 *    an alert saying a competitor committed to build something. Reading "not
 *    planned" as planned would announce a shipping commitment that was a refusal.
 *  - REFUSALS ARE MATCHED FIRST. "Not planned", "won't do" and "closed — declined"
 *    all contain the vocabulary of the states above them, so the catalog is ordered
 *    refusal → delivery → in flight → committed → considering, and the first match
 *    wins.
 *
 * `beta` is deliberately absent: a beta is neither a commitment not yet started nor
 * something generally available, and either reading would move a signal that should
 * not move. It resolves to `other`, which is the honest answer.
 *
 * PURE: no I/O, no DB, no AI.
 */

export const ROADMAP_STATUSES = [
  "under_review",
  "planned",
  "in_progress",
  "delivered",
  "closed",
  "other",
] as const;

export type RoadmapStatus = (typeof ROADMAP_STATUSES)[number];

interface StatusEntry {
  status: Exclude<RoadmapStatus, "other">;
  /** Tested against the NORMALIZED label (see normalizeRoadmapStatusLabel). */
  pattern: RegExp;
}

// prettier-ignore
const ROADMAP_STATUS_CATALOG: readonly StatusEntry[] = [
  // --- Refusals first: they carry the words of every state below them ---
  { status: "closed", pattern: /\b(?:closed|declined|rejected|dismissed|duplicate|archived|cancell?ed|obsolete|out of scope|not (?:planned|doing|done|happening|now)|no(?:t)? going to|won'?t (?:do|build|fix)|wontfix|refuse\w*|rejete\w*|annule\w*|abandonne\w*|hors (?:scope|perimetre)|abgelehnt|geschlossen|verworfen|storniert|nicht geplant|wird nicht)\b/ },

  // --- Delivered. "shipped", never "shipping soon" (that is a promise) ---
  { status: "delivered", pattern: /\b(?:delivered|shipped|done|complete|completed|released|launched|live|ga|generally available|rolled out|resolved|livre|livree?s?|termine\w*|fini\w*|realise\w*|acheve\w*|deploye\w*|fertig|erledigt|abgeschlossen|umgesetzt|veroffentlicht|ausgeliefert|geliefert)\b/ },

  // --- In flight ---
  { status: "in_progress", pattern: /\b(?:in progress|in development|in dev|in build|in the works|underway|started|building|developing|working on|wip|doing|en cours|en developpement|en construction|demarre\w*|in bearbeitung|in arbeit|in entwicklung|wird (?:umgesetzt|entwickelt|gebaut))\b/ },

  // --- Committed but not started. "soon" belongs here, not in delivered ---
  { status: "planned", pattern: /\b(?:planned|planning|roadmap|next up|up next|coming(?: soon)?|shipping soon|soon|scheduled|accepted|approved|committed|queued|to do|todo|prevu\w*|planifie\w*|a venir|prochainement|accepte\w*|geplant|eingeplant|demnachst|bald|angenommen|vorgesehen)\b/ },

  // --- Being considered. Nothing is committed here ---
  { status: "under_review", pattern: /\b(?:under (?:review|consideration)|in review|reviewing|considering|being considered|gathering (?:interest|feedback|votes)|open|new|idea|ideas|suggestion|suggested|proposed|backlog|triage|maybe|exploring|discovery|a l'etude|a etudier|en reflexion|a l'examen|propose\w*|idee\w*|in prufung|wird gepruft|vorschlag|vorgeschlagen|geprueft|uberlegung|in uberlegung)\b/ },
];

/**
 * Lowercase, collapse whitespace, strip diacritics, drop the separators portals
 * decorate a column with ("→ Planned", "Planned (Q3)"). One normalizer, so the
 * catalog and its callers can never disagree about what a label says.
 */
export function normalizeRoadmapStatusLabel(label: string): string {
  return label
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[\u2018\u2019]/g, "'")
    .toLowerCase()
    .replace(/[_/\\|()[\]{}\u2192\u2190\u2022\u00b7\u2014\u2013<>-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Map a portal's own status label onto our vocabulary. First matching entry wins
 * (the catalog orders refusals before everything they could be mistaken for), and
 * anything unmatched is `other` rather than the nearest guess.
 */
export function resolveRoadmapStatus(label: string | null | undefined): RoadmapStatus {
  const normalized = normalizeRoadmapStatusLabel(label ?? "");
  if (!normalized) return "other";
  for (const entry of ROADMAP_STATUS_CATALOG) {
    if (entry.pattern.test(normalized)) return entry.status;
  }
  return "other";
}

/**
 * Is this entry still an OPEN request — something their customers can still be
 * waiting for? `other` counts as open: an unrecognised column is a column we cannot
 * claim is finished, and dropping those entries would silently shrink the "top
 * requested" list to the portals whose vocabulary we happen to know.
 */
export function isOpenRoadmapStatus(status: RoadmapStatus): boolean {
  return status !== "delivered" && status !== "closed";
}

/**
 * Has the competitor COMMITTED to build this? These two statuses, and only these
 * two, are what `top_request_planned` fires on: a request moving into either is the
 * moment a rival publicly took on work their own customers asked for.
 */
export function isCommittedRoadmapStatus(status: RoadmapStatus): boolean {
  return status === "planned" || status === "in_progress";
}

/** Human label for our own vocabulary. Used only where the portal's own wording is
 *  not available — everywhere else the raw label is what gets shown. */
export function roadmapStatusLabel(status: RoadmapStatus): string {
  const labels: Record<RoadmapStatus, string> = {
    under_review: "Under review",
    planned: "Planned",
    in_progress: "In progress",
    delivered: "Delivered",
    closed: "Closed",
    other: "Other",
  };
  return labels[status];
}
