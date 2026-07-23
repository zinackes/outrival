// Single source of truth for every legal document (mentions légales, privacy,
// terms, DPA, subprocessors, …). Editing an identity field here updates every
// legal page at once — LCEN requires these to be kept current.
//
// ⚠️ Outrival is not incorporated yet. Fields marked `TODO` below carry the
// `[À COMPLÉTER]` placeholder and MUST be filled before the site goes to
// production (a missing/false SIRET or RCS is a real legal exposure). The full
// checklist lives in `docs/legal-compliance.md`.

/** Placeholder marker for values the operator must fill before production. */
export const TODO = "[À COMPLÉTER]" as const;

/** The publishing entity — used by mentions légales, privacy, terms, CGV, DPA. */
export const ENTITY = {
  /** Commercial brand shown in the UI. */
  brand: "Outrival",
  /** Registered corporate name. TODO once the company is incorporated. */
  legalName: TODO,
  /** SAS / SARL / SASU / micro-entreprise… TODO. */
  legalForm: TODO,
  /** Share capital, e.g. "1 000 €". TODO (omit for micro-entreprise). */
  capital: TODO,
  /** SIREN / SIRET. TODO. */
  siret: TODO,
  /** RCS registration + city, e.g. "RCS <city> 000 000 000". TODO. */
  rcs: TODO,
  /** Intra-EU VAT number, e.g. "FR00 000000000". TODO. */
  vat: TODO,
  /**
   * Registered office address. TODO — fill from the registration, city
   * included. Deliberately NOT pre-filled with a city: for a micro-entreprise
   * this is the founder's actual address, and the marketing pages say only
   * "France" so that nothing can contradict this line once it is filled.
   */
  address: TODO,
  /** Named individual responsible for publication (LCEN). TODO. */
  publicationDirector: TODO,
  /** Country of establishment / applicable law. */
  country: "France",
} as const;

/** Contact addresses. `general` exists today; the others should be provisioned. */
export const CONTACT = {
  /** Live inbox used across the site today. */
  general: "hello@outrival.app",
  /** Data-protection / GDPR requests. TODO: provision this inbox (recommended). */
  privacy: "privacy@outrival.app",
  /** Security disclosures. TODO: provision (recommended). */
  security: "security@outrival.app",
  /**
   * Data Protection Officer. A DPO is NOT mandatory for a micro-entity whose
   * core activity is not large-scale monitoring of special-category data, so
   * this stays a general privacy contact unless/until a DPO is appointed.
   */
  dpo: TODO,
} as const;

/** Domains operated by Outrival. `outrival.app` is the canonical domain. */
export const DOMAINS = {
  canonical: "outrival.app",
  legacy: "outrival.io",
} as const;

/**
 * Website host, for the "hébergeur" section required by LCEN art. 6-III.
 * Production runs on an OVHcloud VPS (Coolify). ⚠️ Confirm the actual provider
 * before publishing — the architecture doc also references Hetzner.
 * OVHcloud public legal details below are factual and used only to identify
 * the host, as the law requires (a link to the host is not sufficient).
 */
export const HOST = {
  name: "OVH SAS (OVHcloud)",
  address: "2 rue Kellermann, 59100 Roubaix, France",
  phone: "+33 9 72 10 10 07",
  rcs: "RCS Lille Métropole 424 761 419 00045",
  website: "https://www.ovhcloud.com",
  confirm: true,
} as const;

/** Document version + last-updated date, shown on every legal page. */
export const LEGAL_VERSION = {
  version: "1.1",
  updatedIso: "2026-07-22",
  updatedEn: "July 22, 2026",
  updatedFr: "22 juillet 2026",
} as const;

export type Subprocessor = {
  name: string;
  /** What the service does for Outrival. */
  purpose: { en: string; fr: string };
  /** Categories of data it may process on Outrival's behalf. */
  data: { en: string; fr: string };
  /** Hosting / processing location. */
  location: string;
  /** true when the location is outside the EEA (transfer safeguard required). */
  outsideEea: boolean;
  /** Transfer mechanism when `outsideEea` (SCC = EU Standard Contractual Clauses). */
  transfer?: string;
};

/**
 * Current subprocessors. This array is the authoritative source rendered on
 * `/subprocessors`; the DPA grants general authorisation subject to notice of
 * changes. Keep in sync with `docs/architecture.md` (Stack + Env vars).
 */
export const SUBPROCESSORS: Subprocessor[] = [
  {
    name: "OVHcloud (OVH SAS)",
    purpose: { en: "Application & website hosting", fr: "Hébergement de l'application et du site" },
    data: { en: "All service data in compute/transit", fr: "Toutes les données du service en traitement/transit" },
    location: "France (EU)",
    outsideEea: false,
  },
  {
    name: "netcup GmbH",
    purpose: { en: "Background job orchestration & scraping workers (pg-boss queue)", fr: "Orchestration des jobs & workers de scraping (file pg-boss)" },
    data: { en: "Job payloads (competitor & workspace identifiers)", fr: "Charges des jobs (identifiants concurrents & workspace)" },
    location: "Austria (EU)",
    outsideEea: false,
  },
  {
    name: "Neon",
    purpose: { en: "Managed PostgreSQL database (relational + analytics)", fr: "Base PostgreSQL managée (relationnel + analytics)" },
    data: { en: "Account, workspace config, signals, contact-form data", fr: "Compte, configuration, signaux, données du formulaire de contact" },
    location: "EU region",
    outsideEea: false,
  },
  {
    name: "Cloudflare R2",
    purpose: { en: "Object storage (page snapshots, screenshots, PDFs)", fr: "Stockage objet (snapshots de pages, captures, PDF)" },
    data: { en: "Captured public competitor pages, generated documents", fr: "Pages concurrentes publiques capturées, documents générés" },
    location: "EU / global (Cloudflare)",
    outsideEea: true,
    transfer: "EU SCC (Cloudflare DPA)",
  },
  {
    name: "Cloudflare Turnstile",
    purpose: { en: "Bot / abuse protection on public forms", fr: "Protection anti-bot / anti-abus des formulaires publics" },
    data: { en: "IP address, challenge token", fr: "Adresse IP, jeton de challenge" },
    location: "Global (Cloudflare)",
    outsideEea: true,
    transfer: "EU SCC (Cloudflare DPA)",
  },
  {
    name: "Resend",
    purpose: { en: "Transactional email (sign-in, alerts, digests)", fr: "Emails transactionnels (connexion, alertes, digests)" },
    data: { en: "Email address, message content", fr: "Adresse email, contenu du message" },
    location: "United States",
    outsideEea: true,
    transfer: "EU SCC",
  },
  {
    name: "Stripe",
    purpose: { en: "Payments, subscriptions & invoicing", fr: "Paiements, abonnements & facturation" },
    data: { en: "Billing identity, email, payment metadata (card handled by Stripe)", fr: "Identité de facturation, email, métadonnées de paiement (carte gérée par Stripe)" },
    location: "Ireland / United States",
    outsideEea: true,
    transfer: "EU SCC (Stripe DPA)",
  },
  {
    name: "Groq",
    purpose: { en: "AI inference — insights pipeline", fr: "Inférence IA — pipeline d'insights" },
    data: { en: "Prompts derived from monitored public data", fr: "Prompts dérivés des données publiques surveillées" },
    location: "United States",
    outsideEea: true,
    transfer: "EU SCC",
  },
  {
    name: "Cerebras",
    purpose: { en: "AI inference — provider pool (primary)", fr: "Inférence IA — pool de providers (principal)" },
    data: { en: "Prompts derived from monitored public data", fr: "Prompts dérivés des données publiques surveillées" },
    location: "United States",
    outsideEea: true,
    transfer: "EU SCC",
  },
  {
    name: "Hyperbolic",
    purpose: { en: "AI inference — provider pool (paid fallback)", fr: "Inférence IA — pool de providers (secours payant)" },
    data: { en: "Prompts derived from monitored public data", fr: "Prompts dérivés des données publiques surveillées" },
    location: "United States",
    outsideEea: true,
    transfer: "EU SCC",
  },
  {
    name: "Anthropic",
    purpose: { en: "AI inference — Claude fallback", fr: "Inférence IA — secours Claude" },
    data: { en: "Prompts derived from monitored public data", fr: "Prompts dérivés des données publiques surveillées" },
    location: "United States",
    outsideEea: true,
    transfer: "EU SCC",
  },
  {
    name: "Exa.ai",
    purpose: { en: "Competitor discovery (semantic search)", fr: "Découverte de concurrents (recherche sémantique)" },
    data: { en: "Product profile & keywords", fr: "Profil produit & mots-clés" },
    location: "United States",
    outsideEea: true,
    transfer: "EU SCC",
  },
  {
    name: "Perplexity",
    purpose: { en: "AI visibility / share-of-model (optional feature)", fr: "Visibilité IA / share-of-model (fonctionnalité optionnelle)" },
    data: { en: "Brand & competitor prompts", fr: "Prompts marque & concurrents" },
    location: "United States",
    outsideEea: true,
    transfer: "EU SCC",
  },
  {
    name: "Upstash",
    purpose: { en: "Redis — rate-limiting & AI capacity metering", fr: "Redis — limitation de débit & mesure de capacité IA" },
    data: { en: "IP address, request counters", fr: "Adresse IP, compteurs de requêtes" },
    location: "United States / EU",
    outsideEea: true,
    transfer: "EU SCC",
  },
  {
    name: "PostHog",
    purpose: { en: "Product analytics (consent-gated)", fr: "Analytics produit (soumis au consentement)" },
    data: { en: "Usage events, pseudonymised identifier", fr: "Événements d'usage, identifiant pseudonymisé" },
    location: "EU (eu.posthog.com)",
    outsideEea: false,
  },
];
