/**
 * Canonical meter vocabulary (Pricing Intelligence P3).
 *
 * Two competitors only compare on a metered axis if "GB", "Go" and "gigabyte"
 * are ONE identity, and if "API call", "request" and "req" are another. Without
 * that, a cost at 10k units is arithmetic over two things that are not the same
 * thing, and a rewording of the unit on a pricing page reads as a whole new
 * meter appearing.
 *
 * Same shape as entitlement-catalog and period-vocab: data + a pure resolver,
 * zero AI. EN/FR/DE/ES/IT/NL/PT aliases, matched against a normalized label
 * (lowercased, diacritics stripped, leading "per" / "/" and quantities removed),
 * so patterns are written unaccented and singular-with-optional-plural.
 *
 * A unit the catalog does not know is NOT guessed: `resolveMeterUnit` returns it
 * normalized with `canonical: false`. price_tiers still stores that wording (it
 * is the page's own evidence), but no price_point is ever written on it — an
 * unknown meter compared against a known one is the exact error this module
 * exists to prevent.
 *
 * Order matters where vocabularies overlap: the more specific unit precedes the
 * broader one (tracked_user before seat, resolution before conversation,
 * request before message).
 */

interface UnitEntry {
  slug: string;
  /** Tested against the NORMALIZED unit label (see normalizeUnitLabel). */
  pattern: RegExp;
  /** How the unit reads in the UI, singular and plural. */
  label: string;
  plural: string;
}

// prettier-ignore
const UNIT_CATALOG: readonly UnitEntry[] = [
  // --- Data volume (FR go/to and IT/PT need the bare abbreviations too) ---
  { slug: "tb", label: "TB", plural: "TB", pattern: /\btb\b|\bto\b|\btera[- ]?(?:byte|octet)s?\b/ },
  { slug: "gb", label: "GB", plural: "GB", pattern: /\bgb\b|\bgo\b|\bgiga[- ]?(?:byte|octet)s?\b|\bgigabytes?\b/ },
  { slug: "mb", label: "MB", plural: "MB", pattern: /\bmb\b|\bmo\b|\bmega[- ]?(?:byte|octet)s?\b/ },

  // --- API surface (api call before the bare "call", which is also a phone call) ---
  { slug: "request", label: "request", plural: "requests", pattern: /\bapi (?:calls?|requests?|hits?)\b|\brequests?\b|\breqs?\b|\bappels? api\b|\bapi[- ]?aufrufe?\b|\bllamadas? api\b|\bchiamate? api\b|\banfragen?\b|\bsolicitudes?\b|\brichieste?\b|\bverzoeken?\b|\bcalls?\b/ },
  { slug: "lookup", label: "lookup", plural: "lookups", pattern: /\blook ?ups?\b|\bqueries\b|\bquery\b|\brecherches?\b|\bconsultas?\b/ },

  // --- Events & records ---
  { slug: "event", label: "event", plural: "events", pattern: /\bevents?\b|\bevenements?\b|\bereignisse?\b|\beventos?\b|\beventi\b|\bgebeurtenissen?\b/ },
  { slug: "record", label: "record", plural: "records", pattern: /\brecords?\b|\brows?\b|\benregistrements?\b|\bdatensatze?\b|\bregistros?\b|\brighe\b|\brijen\b/ },

  // --- AI / consumption units ---
  { slug: "token", label: "token", plural: "tokens", pattern: /\btokens?\b|\bjetons?\b/ },
  { slug: "credit", label: "credit", plural: "credits", pattern: /\bcredits?\b|\bguthaben\b|\bcreditos?\b|\bcrediti\b|\btegoeden?\b/ },

  // --- People (tracked users are a meter, seats are a subscription unit) ---
  { slug: "tracked_user", label: "tracked user", plural: "tracked users", pattern: /\bmtus?\b|monthly (?:tracked|active) users?\b|\bmaus?\b|utilisateurs? (?:suivis?|actifs?)\b/ },
  { slug: "seat", label: "seat", plural: "seats", pattern: /\bseats?\b|\busers?\b|\bmembers?\b|\beditors?\b|\bteammates?\b|\butilisateurs?\b|\bsieges?\b|\bmembres?\b|\bnutzer\b|\bbenutzer\b|\bplatze?\b|\busuarios?\b|\bmiembros?\b|\butenti\b|\bgebruikers?\b|\bleden\b/ },
  { slug: "contact", label: "contact", plural: "contacts", pattern: /\bcontacts?\b|\bsubscribers?\b|\babonnes?\b|\bkontakte?\b|\bcontactos?\b|\bcontatti\b|\bcontacten\b/ },

  // --- Messaging (sms and email before the broad "message") ---
  { slug: "sms", label: "SMS", plural: "SMS", pattern: /\bsms\b|\btext messages?\b|\btextos?\b/ },
  { slug: "email", label: "email", plural: "emails", pattern: /\be[- ]?mails?\b|\bcourriels?\b|\bcorreos?\b|\bmensagens? de e[- ]?mail\b/ },
  { slug: "message", label: "message", plural: "messages", pattern: /\bmessages?\b|\bnachrichten?\b|\bmensajes?\b|\bmessaggi\b|\bberichten?\b/ },

  // --- Compute & time ---
  { slug: "core", label: "core", plural: "cores", pattern: /\bv?cpus?\b|\bcores?\b|\bcoeurs?\b|\bkerne?\b|\bnucleos?\b/ },
  { slug: "hour", label: "hour", plural: "hours", pattern: /\bhours?\b|\bhrs?\b|\bheures?\b|\bstunden?\b|\bhoras?\b|\bore\b|\buren\b/ },
  { slug: "minute", label: "minute", plural: "minutes", pattern: /\bminutes?\b|\bmins?\b|\bminuten?\b|\bminutos?\b|\bminuti\b/ },

  // --- Commerce & support (resolution before the conversation it happens in) ---
  { slug: "transaction", label: "transaction", plural: "transactions", pattern: /\btransactions?\b|\bpayments?\b|\borders?\b|\bpaiements?\b|\bcommandes?\b|\btransaktionen?\b|\bzahlungen?\b|\btransacciones?\b|\bpedidos?\b|\btransazioni\b|\bordini\b|\btransacties\b|\bbestellingen?\b/ },
  { slug: "resolution", label: "resolution", plural: "resolutions", pattern: /\bresolutions?\b|resolved (?:conversations?|tickets?|issues?)\b|\bresolutions? automatiques?\b/ },
  { slug: "ticket", label: "ticket", plural: "tickets", pattern: /\btickets?\b|\bcases?\b|\banfragen? ?tickets?\b|\bboletos?\b/ },
  { slug: "conversation", label: "conversation", plural: "conversations", pattern: /\bconversations?\b|\bchats?\b|\bgesprache?\b|\bconversaciones?\b|\bconversazioni\b|\bgesprekken?\b/ },

  // --- Web & infrastructure ---
  { slug: "pageview", label: "pageview", plural: "pageviews", pattern: /\bpage ?views?\b|\bviews?\b|\bimpressions?\b|\bpages? vues?\b|\bseitenaufrufe?\b|\bvisitas?\b|\bvisualizzazioni\b/ },
  { slug: "visit", label: "visit", plural: "visits", pattern: /\bvisits?\b|\bsessions?\b|\bvisites?\b|\bbesuche?\b|\bvisite\b|\bbezoeken?\b/ },
  { slug: "domain", label: "domain", plural: "domains", pattern: /\bdomains?\b|\bdomaines?\b|\bdominios?\b|\bdomini\b|\bdomeinen?\b/ },
  { slug: "site", label: "site", plural: "sites", pattern: /\bsites?\b|\bwebsites?\b|\binstall(?:ation)?s?\b|\bwebseiten?\b|\bsitios?\b|\bsiti\b/ },
  { slug: "slot", label: "slot", plural: "slots", pattern: /\bslots?\b|\bemplacements?\b/ },
  { slug: "player", label: "player", plural: "players", pattern: /\bplayers?\b|\bjoueurs?\b|\bspieler\b|\bjugadores?\b|\bgiocatori\b/ },
] as const;

export const CANONICAL_METER_UNITS: ReadonlySet<string> = new Set(
  UNIT_CATALOG.map((u) => u.slug),
);

/**
 * The shape every catalog pattern is written against: lowercase, diacritics
 * stripped, whitespace collapsed, and the framing a pricing page puts around a
 * meter removed — a leading "per" / "/" ("per API call", "/GB") and a leading
 * quantity ("1,000 emails", "10k requests"), which belongs to the tier, not the
 * unit. Also drops a trailing period qualifier ("GB/month" is still GB).
 */
export function normalizeUnitLabel(raw: string): string {
  return raw
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^[/·|-]+\s*/, "")
    .replace(/^(?:per|par|pro|por|elke|each|every)\s+/, "")
    .replace(/^\d[\d.,]*\s*(?:k|m|mn|mio|million|thousand|mille)?\s+/, "")
    .replace(
      /\s*\/\s*(?:mo|month|monthly|mois|monat|mes|mese|maand|yr|year|an|jahr|ano|anno|jaar|day|jour|tag|dia|giorno|dag)\b.*$/,
      "",
    )
    .replace(/\s*\b(?:per|par|pro|por)\s+(?:month|mo|mois|monat|year|yr|an|jahr)\b.*$/, "")
    .replace(/[.,;:]+$/, "")
    .trim();
}

export interface ResolvedMeterUnit {
  /** Catalog slug when canonical, else the normalized page wording. */
  unit: string;
  /** true = a meter two competitors can be compared on. */
  canonical: boolean;
}

/**
 * Map a page's unit wording to its meter identity. The first catalog pattern
 * that matches wins (the catalog orders specific before broad); an unmatched
 * label comes back normalized with canonical=false, never guessed into a
 * neighbouring meter. Pure, zero AI.
 *
 * Returns null only for an empty/blank label — the absence of a unit is not a
 * unit, and callers must not turn it into one.
 */
export function resolveMeterUnit(raw: string | null | undefined): ResolvedMeterUnit | null {
  if (raw == null) return null;
  const normalized = normalizeUnitLabel(raw);
  if (!normalized) return null;
  for (const entry of UNIT_CATALOG) {
    if (entry.pattern.test(normalized)) return { unit: entry.slug, canonical: true };
  }
  return { unit: normalized, canonical: false };
}

/** True when the wording names a meter the comparison layer can stand on. */
export function isCanonicalMeterUnit(unit: string | null | undefined): boolean {
  return unit != null && CANONICAL_METER_UNITS.has(unit);
}

const DISPLAY = new Map(UNIT_CATALOG.map((u) => [u.slug, u]));

/**
 * How a meter reads in the UI: "10,000 requests", "500 GB". Falls back to the
 * stored wording for a non-canonical unit (with a naive plural only when we
 * know the word, so we never write "GBs").
 */
export function meterUnitLabel(unit: string, count?: number): string {
  const entry = DISPLAY.get(unit);
  if (!entry) return unit;
  return count != null && count !== 1 ? entry.plural : entry.label;
}
