/**
 * Canonical entitlement vocabulary (Pricing Intelligence P2).
 *
 * A features × plans matrix is only diffable across scrapes if "SSO", "Single
 * sign-on" and "Authentification unique" collapse to ONE identity — otherwise a
 * rewording reads as a feature removed plus a feature added. This catalog maps
 * the ~35 entitlements that actually move between SaaS plans to stable slugs,
 * with EN/FR/DE/ES/IT/NL/PT aliases, the period-vocab pattern: data + a pure
 * resolver, zero AI for anything the catalog matches.
 *
 * A label the catalog does not know still enters the matrix — slugified, with
 * is_canonical=0 — but the SIGNAL layer only trusts canonical slugs for
 * appear/disappear/move detection: a free-text slug is exactly the label's
 * wording, so a marketing rewording would churn it (see entitlement-diff).
 *
 * Alias regexes are matched against a whitespace-collapsed, lowercased,
 * diacritics-stripped label, so patterns are written unaccented ("retencion"
 * matches "retención"). They are substring matches with word boundaries — a
 * verbatim label often embeds its value ("Up to 5 users", "30-day retention").
 * Order matters where vocabularies overlap: the more specific slug precedes the
 * broader one (sso_scim before sso, dedicated_support before support_tier).
 */

export const ENTITLEMENT_KINDS = ["boolean", "config", "metered"] as const;
export type EntitlementKind = (typeof ENTITLEMENT_KINDS)[number];

interface CatalogEntry {
  slug: string;
  /** Tested against the NORMALIZED label (see normalizeFeatureLabel). */
  pattern: RegExp;
}

// prettier-ignore
export const ENTITLEMENT_CATALOG: readonly CatalogEntry[] = [
  // --- Identity & access (specific before broad: SCIM outranks plain SSO) ---
  { slug: "sso_scim", pattern: /\bscim\b|\bprovisioning\b|directory sync|\bsync[- ]?(?:ad|ldap)\b/ },
  { slug: "sso", pattern: /\bsso\b|single sign[- ]?on|\bsaml\b|\boidc\b|authentification unique|anmeldung uber|inicio de sesion unico|accesso unico|eenmalige aanmelding/ },
  { slug: "two_factor_auth", pattern: /\b2fa\b|\bmfa\b|two[- ]?factor|multi[- ]?factor|double authentification|zwei[- ]?faktor|dos factores|due fattori|twee[- ]?factor|dois fatores/ },
  { slug: "custom_roles", pattern: /custom (?:roles?|permissions?)|role[- ]based|\brbac\b|granular permissions?|roles? personnalises?|benutzerdefinierte rollen|roles? personalizad|ruoli personalizzati|aangepaste rollen|fun[c]?oes personalizadas/ },
  { slug: "ip_allowlist", pattern: /ip (?:allow ?list|white ?list|restriction)|liste blanche ip|ip[- ]?beschrankung/ },
  { slug: "domain_capture", pattern: /domain (?:capture|claiming|verification)/ },

  // --- Seats & collaboration ---
  { slug: "seats_included", pattern: /\b(?:users?|seats?|members?|editors?|teammates?)\b(?! ?guide)|\butilisateurs?\b|\bsieges?\b|\bmembres?\b|\bbenutzer\b|\bnutzer\b|\bmitglieder\b|\busuarios?\b|\bmiembros?\b|\butenti\b|\bgebruikers?\b|\bleden\b|\busuarios? incluidos\b/ },
  { slug: "guest_access", pattern: /\bguests?\b|guest access|\binvites?\b(?! sent)|\bgasten?\b|invitados/ },
  { slug: "workspaces", pattern: /\bworkspaces?\b|\bteams?\b(?! ?members)|espaces? de travail|arbeitsbereiche|espacios? de trabajo|aree di lavoro|werkruimtes/ },
  { slug: "projects", pattern: /\bprojects?\b|\bprojets?\b|\bprojekte?\b|\bproyectos?\b|\bprogetti\b|\bprojecten\b|\bprojetos?\b/ },

  // --- Platform & API ---
  { slug: "api_rate_limit", pattern: /(?:api )?rate limits?|requests? (?:per|\/) ?(?:second|minute|min)|limite de requetes/ },
  { slug: "api_calls", pattern: /api (?:calls?|requests?|credits?)|appels? api|api[- ]?aufrufe|llamadas api|chiamate api|api[- ]?oproepen/ },
  { slug: "api_access", pattern: /\bapi\b(?! (?:calls?|requests?|rate|credits?))|acces api|api[- ]?zugriff|acceso api|accesso api|api[- ]?toegang/ },
  { slug: "webhooks", pattern: /\bweb[- ]?hooks?\b/ },
  { slug: "integrations", pattern: /\bintegrations?\b|\bconnectors?\b|\bintegraciones\b|\bintegrazioni\b|\bintegraties\b|\bintegra[c]?oes\b|\bintegrationen\b/ },
  { slug: "sandbox", pattern: /\bsandbox(?:es)?\b|test (?:environments?|mode)|environnements? de test|testumgebung|entornos? de prueba|ambienti di test|testomgeving/ },
  { slug: "environments", pattern: /\benvironments?\b|\benvironnements?\b|\bumgebungen\b|\bentornos?\b|\bambienti\b|\bomgevingen\b/ },
  { slug: "custom_domain", pattern: /custom domains?|(?:your|own) domain|domaine personnalise|eigene domain|dominio (?:personalizado|propio|personalizzato)|eigen domein/ },

  // --- Data & compliance ---
  { slug: "audit_log", pattern: /audit (?:logs?|trails?)|journal d'audit|audit[- ]?protokoll|registro de auditoria|log di audit|auditlog|trilha de auditoria/ },
  { slug: "retention", pattern: /\bretention\b|(?<!version )\bhistory\b(?! of)|aufbewahrung|\bretencion\b|\bconservazione\b|\bretentie\b|\bretencao\b|\bhistorique\b|\bverlauf\b|\bhistorial\b/ },
  { slug: "exports", pattern: /\bexports?\b(?! api)|\bcsv\b|data (?:export|download)|exportation|exportar|esporta|exporteren/ },
  { slug: "backups", pattern: /\bback[- ]?ups?\b|\bsauvegardes?\b|\bsicherung(?:en)?\b|copias? de seguridad/ },
  { slug: "data_residency", pattern: /data residency|residence des donnees|eu (?:hosting|data)|datenstandort|residencia de datos|residenza dei dati/ },
  { slug: "compliance_certs", pattern: /\bsoc ?2\b|\bhipaa\b|\biso ?27001\b|\bcompliance\b|\bconformite\b|\bkonformitat\b|\bcumplimiento\b|\bconformita\b|\bnaleving\b/ },
  { slug: "gdpr_dpa", pattern: /\bgdpr\b|\brgpd\b|\bdpa\b|data processing agreement/ },
  // Bare FR units (go/to) need a leading number — "go"/"to" are ordinary words.
  { slug: "storage", pattern: /\bstorage\b|\bstockage\b|\bspeicher(?:platz)?\b|\balmacenamiento\b|\barchiviazione\b|\bopslag\b|\barmazenamento\b|\b(?:gb|tb)\b|\b\d[\d.,]* ?(?:go|to)\b/ },

  // --- Support & services ---
  { slug: "dedicated_support", pattern: /dedicated (?:support|csm|success|account manager)|customer success manager|\bcsm\b|account manager|support dedie|dedizierter support|soporte dedicado|supporto dedicato|toegewijde ondersteuning/ },
  { slug: "priority_support", pattern: /priority support|support prioritaire|priorisierter support|soporte prioritario|supporto prioritario|prioriteitsondersteuning|suporte prioritario/ },
  { slug: "support_tier", pattern: /\bsupport\b|\bassistance\b|\bhelp ?desk\b|\bsoporte\b|\bsupporto\b|\bondersteuning\b|\bsuporte\b|\bkundendienst\b/ },
  { slug: "onboarding_training", pattern: /\bonboarding\b|\btraining\b|\bformation\b|\bschulung\b|\bformacion\b|\bformazione\b|\bopleiding\b|\btreinamento\b|implementation support/ },
  { slug: "sla", pattern: /\bslas?\b|service[- ]level|uptime (?:guarantee|commitment)|garantie de disponibilite|verfugbarkeitsgarantie/ },

  // --- Product surface ---
  { slug: "analytics", pattern: /\banalytics\b|advanced report(?:s|ing)|\breports?\b|\brapports?\b|\bberichte\b|\binformes\b|\breportistica\b|\brapportages?\b|\brelatorios\b|\bstatisti(?:cs|ques|ken|che)\b/ },
  { slug: "dashboards", pattern: /\bdash ?boards?\b|tableaux? de bord|paneles?(?: de control)?|cruscotti/ },
  { slug: "white_label", pattern: /white[- ]?label|remove (?:our )?branding|(?:custom|no) branding|marque blanche|marca blanca|senza marchio|zonder branding|marca branca|branding entfernen/ },
  { slug: "custom_fields", pattern: /custom (?:fields?|properties)|champs? personnalises?|benutzerdefinierte felder|campos? personalizados?|campi personalizzati|aangepaste velden/ },
  { slug: "templates", pattern: /\btemplates?\b|\bmodeles?\b|\bvorlagen\b|\bplantillas\b|\bmodelli\b|\bsjablonen\b|\bmodelos\b/ },
  { slug: "automations", pattern: /\bautomations?\b|\bworkflows?\b|\bautomatisations?\b|\bautomatisierung(?:en)?\b|\bautomatizaciones\b|\bautomazioni\b|\bautomatiseringen\b|\bautoma[c]?oes\b/ },
  { slug: "version_history", pattern: /version history|\bversioning\b|historique des versions|versionsverlauf|historial de versiones|cronologia (?:delle )?versioni|versiegeschiedenis/ },
  { slug: "credits", pattern: /\bcredits?\b|\bcredits? (?:ia|ai)\b|\bguthaben\b|\bcreditos?\b|\bcrediti\b/ },

  // --- Deployment ---
  { slug: "on_premise", pattern: /on[- ]?prem(?:ise)?s?|self[- ]?host(?:ed|ing)?|auto[- ]?heberge/ },
] as const;

export const CANONICAL_ENTITLEMENT_SLUGS: ReadonlySet<string> = new Set(
  ENTITLEMENT_CATALOG.map((e) => e.slug),
);

/**
 * Lowercase, collapse whitespace, strip diacritics — the shape every catalog
 * pattern is written against, and the shape the anti-hallucination substring
 * check compares in (one normalizer, so the two can never disagree).
 */
export function normalizeFeatureLabel(label: string): string {
  return label
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[\u2018\u2019]/g, "'")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** Deterministic fallback identity for a label the catalog does not know:
 * "Priority e-mail routing " → "priority_e_mail_routing". Bounded so a
 * paragraph-length cell can't mint an unbounded slug. */
export function slugifyFeatureLabel(label: string): string {
  const slug = normalizeFeatureLabel(label)
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 60)
    .replace(/_+$/g, "");
  return slug || "unlabeled";
}

export interface ResolvedFeatureSlug {
  slug: string;
  /** true = catalog slug (stable across rewordings), false = slugified label. */
  isCanonical: boolean;
}

/**
 * Map a verbatim feature label to its identity: the first catalog pattern that
 * matches wins (the catalog orders specific before broad), else the slugified
 * label with isCanonical=false. Pure, zero AI.
 */
export function resolveFeatureSlug(label: string): ResolvedFeatureSlug {
  const normalized = normalizeFeatureLabel(label);
  for (const entry of ENTITLEMENT_CATALOG) {
    if (entry.pattern.test(normalized)) return { slug: entry.slug, isCanonical: true };
  }
  return { slug: slugifyFeatureLabel(label), isCanonical: false };
}
