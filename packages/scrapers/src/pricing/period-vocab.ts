/**
 * Billing period / unit vocabulary, shared by the AI-free harvest floor and the
 * period reconciler. Kept in one module because the two read the SAME page text
 * and must agree on what "/mo" and "billed annually" mean — two copies of these
 * regexes would drift and reintroduce the very ambiguity the reconciler exists
 * to remove.
 *
 * EN + FR + the EU languages Outrival monitors (DE/ES/IT/NL/PT): a German
 * "49 € pro Monat" is as monthly as "$49/mo". Every non-EN form is ANCHORED to a
 * slash or a preposition — a bare `\bmes\b` would fire on the French possessive
 * ("mes données"), `\ban(no)?\b` on ordinary prose. Longer alternatives precede
 * their prefixes ("mese" before "mes", "anno" before "an"), otherwise the shorter
 * one matches and its \b fails.
 */

// Usage units win over a bare period so "$0.10 / GB" is `usage`, not `monthly`.
export const USAGE_UNIT =
  /\/\s?(gb|go|tb|to|request|req|api\s?call|call|lookup|credit|message|token|email|sms|minute|core|vcpu|slot|player)\b/i;

export const YEARLY =
  /\/\s?(yr|year|ann?[ée]e?|anno|a[ñn]o|jahr|jaar|an)\b|per\s+year|\byearly\b|\bannual(ly)?\b|par\s+an\b|pro\s+jahr\b|\bj[äa]hrlich\b|al\s+a[ñn]o\b|por\s+ano\b|all'anno\b|per\s+jaar\b|\banual(mente)?\b|\bannuale\b|\bjaarlijks\b/i;

export const MONTHLY =
  /\/\s?(mo|month|mois|monat|mese|m[eê]s|maand)\b|per\s+month|\bmonthly\b|par\s+mois\b|pro\s+monat\b|\bmonatlich\b|al\s+mes\b|al\s+mese\b|por\s+m[eê]s\b|per\s+maand\b|\bmensual(mente)?\b|\bmensile\b|\bmensal\b|\bmaandelijks\b/i;

export const ONE_TIME =
  /\bone[-\s]?time\b|\blifetime\b|\bune\s+fois\b|\b[àa]\s+vie\b|\bsetup\s+fee\b/i;

// Per-seat/user is a subscription with a unit, not metered usage.
export const PER_SEAT =
  /\/\s?(user|seat|utilisateur|si[èe]ge|member|nutzer|usuario|utente|gebruiker)\b|per\s+(user|seat)\b|pro\s+nutzer\b|por\s+usuario\b/i;

// "billed annually" states the COMMITMENT, not the period of the amount shown:
// "$10/mo billed annually" is a MONTHLY rate under a yearly term. YEARLY's
// `\bannual(ly)?\b` branch matches "annually", so without this phrase detector a
// per-month figure flips into a per-YEAR one — the 12x error this vocabulary and
// `reconcileBillingPeriods` exist to prevent.
export const ANNUAL_COMMITMENT =
  /\b(billed|paid|invoiced|charged)\s+(annually|yearly|per\s+year)\b|\bfactur[ée]s?\s+annuellement\b|\bj[äa]hrliche?\s+abrechnung\b|\bfacturado\s+anualmente\b|\bfatturato\s+annualmente\b/i;
