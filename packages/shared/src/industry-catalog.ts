/**
 * Canonical industry vocabulary (Content Intelligence v2 P3).
 *
 * A competitor's case study says who its customer is in whatever words its
 * marketing team chose: "a leading fintech", "une banque régionale", "Versicherung",
 * "payments company". The question the feature has to answer is one comparison —
 * IS THIS THE READER'S OWN MARKET — and that comparison only works if those four
 * strings collapse to one identity. So this is the same shape as
 * `entitlement-catalog`: data, a pure resolver, and zero AI for anything the
 * catalog matches.
 *
 * The stakes are asymmetric, which is why the resolver never guesses. A canonical
 * slug on both sides is what raises `case_study_published` from medium to HIGH, so
 * a loose match would page somebody about a market they are not in. A label the
 * catalog does not know still gets stored — slugified, `isCanonical` false — because
 * a case study about "quantum computing" is still a case study; it simply can never
 * raise the severity, since a free-text slug is just that page's wording and would
 * match nothing but itself.
 *
 * Patterns are tested against a whitespace-collapsed, lowercased, diacritics-stripped
 * label, so they are written unaccented ("sante" matches "santé"). Order matters
 * where vocabularies overlap: the more specific slug precedes the broader one
 * (insurance before fintech, biotech_pharma before healthcare, hr_tech before saas).
 */

interface IndustryEntry {
  slug: string;
  /** Tested against the NORMALIZED label (see normalizeIndustryLabel). */
  pattern: RegExp;
}

// prettier-ignore
export const INDUSTRY_CATALOG: readonly IndustryEntry[] = [
  // --- Money (specific before broad: crypto and insurance are not "fintech") ---
  { slug: "crypto_web3", pattern: /\bcrypto\w*|\bweb ?3\b|\bblockchain\b|\bdefi\b|\bnfts?\b|\bstablecoins?\b|\bkryptow/ },
  { slug: "insurance", pattern: /\binsur\w*|\binsurtech\b|\bassurance\b|\bassureur\w*|\bversicherung\w*|\bcourtier\b|\bbroker(?:age)?\b/ },
  { slug: "fintech", pattern: /\bfin ?tech\b|\bbank\w*|\bbanque\w*|\bbanca\b|\bpayments?\b|\bpaiements?\b|\bzahlung\w*|\bfinanc\w*|\blending\b|\bneobank\w*|\bwealth (?:management|tech)\b|\baccounts? payable\b/ },

  // --- Health (a pharma customer is not a hospital) ---
  { slug: "biotech_pharma", pattern: /\bbio ?tech\w*|\bpharma\w*|\blife ?sciences?\b|\bclinical trials?\b|\bdrug (?:discovery|development)\b|\bmedtech\b|\bdiagnostics?\b/ },
  { slug: "healthcare", pattern: /\bhealth ?care\b|\bhealth\b|\bmedical\b|\bhospitals?\b|\bclinics?\b|\bpatients?\b|\btelehealth\b|\bsante\b|\bhopital\w*|\bgesundheit\w*|\bkrankenhaus\w*|\bpraxis\b/ },

  // --- Work & people ---
  { slug: "hr_tech", pattern: /\bhr ?(?:tech|software|teams?)?\b|\bhuman resources\b|\brecruit\w*|\btalent acquisition\b|\bpayrolls?\b|\bhris\b|\bstaffing\b|\bressources humaines\b|\bpersonalwesen\b|\bpersonalabteilung\b/ },

  // --- Go-to-market ---
  { slug: "adtech", pattern: /\bad ?tech\b|\badvertis\w*|\bprogrammatic\b|\bmedia buying\b|\bpublicite\b|\bregie publicitaire\b|\bwerbung\b|\bwerbeagentur\b/ },
  { slug: "martech", pattern: /\bmar ?tech\b|\bmarketing\b|\bcrm\b|\bdemand gen\w*|\bgrowth teams?\b|\bseo\b|\bmarketing automation\b/ },

  // --- Knowledge work ---
  { slug: "edtech", pattern: /\bed ?tech\b|\beducation\w*|\bschools?\b|\buniversit\w*|\be-? ?learning\b|\blearning platforms?\b|\bformation\b|\becoles?\b|\bbildung\w*|\bhochschul\w*/ },
  { slug: "legal", pattern: /\blegal\b|\blaw ?(?:firms?|practice)?\b|\blawyers?\b|\battorneys?\b|\bjuridique\b|\bavocat\w*|\bcabinet d'avocats\b|\bkanzlei\w*|\brechtsanwalt\w*/ },
  { slug: "security", pattern: /\bcyber ?security\b|\binfosec\b|\bsecurity teams?\b|\bsoc teams?\b|\bsiem\b|\bcybersecurite\b|\bsecurite informatique\b|\bit-? ?sicherheit\b/ },
  { slug: "developer_tools", pattern: /\bdev ?(?:tools?|ops)\b|\bdeveloper (?:tools?|platforms?|teams?)\b|\bengineering teams?\b|\bapi platforms?\b|\bci ?\/? ?cd\b|\bplatform engineering\b/ },
  { slug: "professional_services", pattern: /\bconsult\w*|\baccounting\b|\bprofessional services\b|\baudit\w*|\bconseil\b|\bcomptabilite\b|\bexpert-? ?comptable\b|\bberatung\w*|\bwirtschaftsprufung\b/ },
  { slug: "agencies", pattern: /\bagenc(?:y|ies)\b|\bfreelancers?\b|\bcreative studios?\b|\bagences?\b|\bagentur\w*/ },

  // --- Selling things ---
  { slug: "ecommerce", pattern: /\be-? ?commerce\b|\bonline (?:stores?|retail)\b|\bd2c\b|\bdtc\b|\bshopify\b|\bmarketplaces?\b|\bboutique en ligne\b|\bvente en ligne\b|\bonline ?shops?\b|\bversandhandel\b/ },
  { slug: "retail", pattern: /\bretail\w*|\bbrick[- ]and[- ]mortar\b|\bpoint of sale\b|\bstores?\b|\bcommerce de detail\b|\bdistribution\b|\beinzelhandel\b|\bfiliale\w*/ },
  { slug: "food_beverage", pattern: /\bfood\b|\bbeverages?\b|\bcpg\b|\bgroceries\b|\bgrocery\b|\bagroalimentaire\b|\bagro-?alimentaire\b|\blebensmittel\w*|\bgetranke\b/ },

  // --- Physical operations ---
  { slug: "manufacturing", pattern: /\bmanufactur\w*|\bfactor(?:y|ies)\b|\bindustrial\b|\bproduction (?:lines?|teams?)\b|\bfabrication\b|\bindustrie\b|\bfertigung\w*|\bproduktion\b/ },
  { slug: "logistics", pattern: /\blogistics?\b|\bsupply chains?\b|\bfreight\b|\b3pl\b|\bwarehous\w*|\bfleet operations\b|\blogistique\b|\btransport\w*|\bspedition\w*|\blieferkette\b/ },
  { slug: "construction", pattern: /\bconstruction\b|\bcontractors?\b|\bbuilding sites?\b|\barchitecture firms?\b|\bbtp\b|\bbatiment\b|\bbauwesen\b|\bbaufirma\w*/ },
  { slug: "real_estate", pattern: /\breal ?estate\b|\bprop ?tech\b|\bpropert(?:y|ies)\b|\bbrokerages?\b|\bimmobilier\w*|\bimmobilien\w*/ },
  { slug: "automotive", pattern: /\bautomotive\b|\bcar (?:dealers?|manufacturers?)\b|\bev\b|\bmobility\b|\bautomobile\w*|\bkfz\b|\bfahrzeug\w*/ },
  { slug: "energy", pattern: /\benergy\b|\butilit(?:y|ies)\b|\bsolar\b|\boil and gas\b|\brenewables?\b|\benergie\w*|\bstromversorg\w*/ },
  { slug: "telecom", pattern: /\btele ?(?:com|communications?)\b|\btelcos?\b|\bisps?\b|\bcarriers?\b|\bmobile operators?\b|\btelekommunikation\b/ },

  // --- Places people go ---
  { slug: "hospitality", pattern: /\bhospitality\b|\bhotels?\b|\brestaurants?\b|\bhotellerie\b|\brestauration\b|\bgastronomie\b|\bgastgewerbe\b/ },
  { slug: "travel", pattern: /\btravel\b|\btourism\b|\bairlines?\b|\btour operators?\b|\bvoyages?\b|\btourisme\b|\breise\w*/ },
  { slug: "fitness_wellness", pattern: /\bfitness\b|\bgyms?\b|\bwellness\b|\bspas?\b|\bsalons?\b|\bbien-? ?etre\b|\bfitnessstudio\w*/ },

  // --- Attention ---
  { slug: "gaming", pattern: /\bgaming\b|\bgame (?:studios?|developers?)\b|\bvideo ?games?\b|\besports?\b|\bjeux ?video\b|\bspieleentwickl\w*/ },
  { slug: "media", pattern: /\bmedia\b|\bpublish\w*|\bnewsrooms?\b|\bbroadcast\w*|\bstreaming\b|\bentertainment\b|\bmedien\b|\bedition\b|\bpresse\b/ },

  // --- Public & mission ---
  { slug: "nonprofit", pattern: /\bnon-? ?profits?\b|\bngos?\b|\bcharit(?:y|ies)\b|\bfoundations?\b|\bassociations?\b|\bong\b|\bgemeinnutzig\w*|\bstiftung\w*/ },
  { slug: "government", pattern: /\bgovernment\w*|\bpublic sector\b|\bmunicipalit(?:y|ies)\b|\bagencies of the state\b|\bsecteur public\b|\bcollectivites?\b|\bbehorde\w*|\boffentliche verwaltung\b/ },

  // --- The broad one, deliberately last: almost every B2B page says "software" ---
  { slug: "saas", pattern: /\bsaas\b|\bb2b software\b|\bsoftware compan(?:y|ies)\b|\btech (?:startups?|compan(?:y|ies))\b|\bcloud software\b|\blogiciels?\b|\bsoftwareunternehmen\b/ },
] as const;

export const CANONICAL_INDUSTRY_SLUGS: ReadonlySet<string> = new Set(
  INDUSTRY_CATALOG.map((e) => e.slug),
);

/**
 * Lowercase, collapse whitespace, strip diacritics — the shape every catalog
 * pattern is written against. One normalizer, so the catalog and its callers can
 * never disagree about what a label says.
 */
export function normalizeIndustryLabel(label: string): string {
  return label
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[\u2018\u2019]/g, "'")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** Deterministic identity for a label the catalog does not know: "Quantum
 *  computing " → "quantum_computing". Bounded so a sentence cannot mint a slug. */
export function slugifyIndustryLabel(label: string): string {
  const slug = normalizeIndustryLabel(label)
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40)
    .replace(/_+$/g, "");
  return slug || "unknown";
}

export interface ResolvedIndustry {
  slug: string;
  /** true = catalog slug (comparable across two companies' wordings). */
  isCanonical: boolean;
}

/**
 * Map a verbatim industry label to its identity: the first catalog pattern that
 * matches wins (the catalog orders specific before broad), else the slugified
 * label with isCanonical=false. Pure, zero AI.
 */
export function resolveIndustry(label: string): ResolvedIndustry {
  const normalized = normalizeIndustryLabel(label);
  if (!normalized) return { slug: "unknown", isCanonical: false };
  for (const entry of INDUSTRY_CATALOG) {
    if (entry.pattern.test(normalized)) return { slug: entry.slug, isCanonical: true };
  }
  return { slug: slugifyIndustryLabel(label), isCanonical: false };
}

/**
 * Which market the READER sells into, from the free text their own product profile
 * carries — and null when that text names no market this catalog knows.
 *
 * Null is the common, correct answer and it is load-bearing: it is what makes the
 * HIGH severity on `case_study_published` impossible rather than approximate. A
 * workspace whose profile reads "project management tool" has told us nothing about
 * a vertical, and a case study about a hospital is not more urgent for them than for
 * anyone else. Guessing here would page the wrong people about the wrong market.
 *
 * `audience` is consulted BEFORE `category`, because the question is who they SELL
 * TO. A workspace whose category is "CRM software" and whose audience is "insurance
 * brokers" is in the insurance market; reading the category first would file it as
 * martech and mute exactly the case study that matters to them.
 */
export function resolveUserIndustry(profile: {
  audience?: string | null;
  category?: string | null;
}): string | null {
  for (const text of [profile.audience, profile.category]) {
    if (!text?.trim()) continue;
    const resolved = resolveIndustry(text);
    if (resolved.isCanonical) return resolved.slug;
  }
  return null;
}

/** Human label for a canonical slug ("hr_tech" → "HR tech"). Free-text slugs are
 *  de-slugified as-is, which is what they were: that page's own wording. */
export function industryLabel(slug: string): string {
  const explicit: Record<string, string> = {
    hr_tech: "HR tech",
    ad_tech: "ad tech",
    adtech: "adtech",
    martech: "martech",
    edtech: "edtech",
    fintech: "fintech",
    saas: "SaaS",
    crypto_web3: "crypto / web3",
    biotech_pharma: "biotech & pharma",
    developer_tools: "developer tools",
    professional_services: "professional services",
    real_estate: "real estate",
    food_beverage: "food & beverage",
    fitness_wellness: "fitness & wellness",
  };
  return explicit[slug] ?? slug.replace(/_/g, " ");
}
