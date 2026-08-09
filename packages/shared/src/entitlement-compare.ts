// Pricing Intelligence — comparing two captured entitlement matrices against each
// other (OUT-68). Sibling of entitlement-diff, which compares one competitor with
// ITSELF over time; this one compares two competitors at one point in time, which
// is a different trust problem.
//
// The model is FEATURE-ANCHORED, not plan-aligned. Plans are never paired: a row
// is one canonical feature, and each side answers with the cheapest plan that
// carries it plus what that plan costs per month. That answers "who gives more
// for the money" without ever asserting that their tier 2 equals your tier 2 —
// the claim the price-rank comparison already refuses to make.
//
// Trust boundary, same as entitlement-diff: only CANONICAL slugs cross sides. A
// free-text slug IS one page's exact wording, so matching it against another
// company's page is a string coincidence, not a fact. Free-text rows stay visible
// in the single-competitor matrix and never enter a comparison.
//
// Absence is not a denial. A feature missing from a captured matrix means the
// pricing page did not list it, which is not the same as "they don't offer it".
// Callers must render that state as "not listed", never "not offered".
//
// Pure: no I/O, no AI, every value traces to a stored plan_entitlements row.

import { CANONICAL_ENTITLEMENT_SLUGS, ENTITLEMENT_CATALOG, ENTITLEMENT_KINDS } from "./entitlement-catalog";
import type { EntitlementKind } from "./entitlement-catalog";
import type { EntitlementRow } from "./entitlement-diff";
import { normalizePlanKey } from "./pricing";
import { formatPrice } from "./pricing-diff";
import { resolveMeterUnit } from "./unit-alias";

/** One side of the comparison: a captured matrix plus what its plans cost.
 * `planMonthly` is keyed by normalizePlanKey so entitlement rows and pricing rows
 * join on the identity the rest of the pricing code already uses. A plan absent
 * from the map, or mapped to null, is quote-based: it carries no price verdict. */
export interface SidePlans {
  cells: readonly EntitlementRow[];
  planMonthly: ReadonlyMap<string, number | null>;
}

/** The cheapest plan on one side that lists the feature, and what it gives. */
export interface FeatureSide {
  planName: string;
  monthly: number | null;
  valueNum: number | null;
  valueText: string | null;
  unit: string | null;
}

/** Read from OUR point of view: "cheaper" = we unlock it for less than they do. */
export type PriceVerdict = "cheaper" | "pricier" | "same" | "only_us" | "only_them";

/** Read from OUR point of view: "higher" = our plan grants the larger number. */
export type LimitVerdict = "higher" | "lower" | "equal";

export interface FeatureComparisonRow {
  slug: string;
  /** Catalog-stable English label, not one page's wording (which may be in any
   * language the extractor met). */
  label: string;
  kind: EntitlementKind;
  /** null = not listed on that side's captured matrix. */
  ours: FeatureSide | null;
  theirs: FeatureSide | null;
  priceVerdict: PriceVerdict | null;
  limitVerdict: LimitVerdict | null;
}

/**
 * How each canonical slug reads in the UI. Kept next to the comparison rather
 * than in the catalog because it is display copy, and the catalog is matching
 * machinery. A slug added to the catalog without a line here falls back to its
 * titleized form, which is legible enough to ship on.
 */
const FEATURE_LABELS: Readonly<Record<string, string>> = {
  sso_scim: "SCIM provisioning",
  sso: "Single sign-on",
  two_factor_auth: "Two-factor authentication",
  custom_roles: "Custom roles",
  ip_allowlist: "IP allowlist",
  domain_capture: "Domain capture",
  seats_included: "Seats included",
  guest_access: "Guest access",
  workspaces: "Workspaces",
  projects: "Projects",
  api_rate_limit: "API rate limit",
  api_calls: "API calls",
  api_access: "API access",
  webhooks: "Webhooks",
  integrations: "Integrations",
  sandbox: "Sandbox",
  environments: "Environments",
  custom_domain: "Custom domain",
  audit_log: "Audit log",
  retention: "Data retention",
  exports: "Exports",
  backups: "Backups",
  data_residency: "Data residency",
  compliance_certs: "Compliance certifications",
  gdpr_dpa: "GDPR / DPA",
  storage: "Storage",
  dedicated_support: "Dedicated support",
  priority_support: "Priority support",
  support_tier: "Support",
  onboarding_training: "Onboarding and training",
  sla: "SLA",
  analytics: "Analytics",
  dashboards: "Dashboards",
  white_label: "White label",
  custom_fields: "Custom fields",
  templates: "Templates",
  automations: "Automations",
  version_history: "Version history",
  credits: "Credits",
  on_premise: "Self-hosted",
};

/** The catalog's own order, which groups by theme (identity, seats, platform,
 * data, support, product surface, deployment). Rows keep it, so two competitors
 * always read in the same sequence. */
const CATALOG_ORDER = new Map(ENTITLEMENT_CATALOG.map((entry, i) => [entry.slug, i]));

export function featureLabel(slug: string): string {
  const known = FEATURE_LABELS[slug];
  if (known) return known;
  const words = slug.replace(/_/g, " ").trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : slug;
}

const isCanonicalRow = (row: EntitlementRow): boolean =>
  row.is_canonical === 1 || row.is_canonical === true || CANONICAL_ENTITLEMENT_SLUGS.has(row.feature_slug);

const isKnownKind = (kind: string): kind is EntitlementKind =>
  (ENTITLEMENT_KINDS as readonly string[]).includes(kind);

interface PickedPlan {
  cell: EntitlementRow;
  monthly: number | null;
}

/**
 * The cheapest plan on this side that lists the feature. A quote-based plan wins
 * only when no priced plan carries the feature: "enterprise, call us" is an
 * answer, but it is the last one we want to show against a competitor's $19 tier.
 */
function pickPlan(side: SidePlans, slug: string): PickedPlan | null {
  let best: PickedPlan | null = null;
  for (const cell of side.cells) {
    if (cell.feature_slug !== slug) continue;
    if (!isCanonicalRow(cell)) continue;
    const monthly = side.planMonthly.get(normalizePlanKey(cell.plan_name)) ?? null;
    if (best === null) {
      best = { cell, monthly };
      continue;
    }
    if (monthly === null) continue;
    if (best.monthly === null || monthly < best.monthly) best = { cell, monthly };
  }
  return best;
}

const toSide = (picked: PickedPlan): FeatureSide => ({
  planName: picked.cell.plan_name,
  monthly: picked.monthly,
  valueNum: picked.cell.value_num ?? null,
  valueText: picked.cell.value_text ?? null,
  unit: picked.cell.unit ?? null,
});

function priceVerdictOf(ours: FeatureSide | null, theirs: FeatureSide | null): PriceVerdict | null {
  if (ours && !theirs) return "only_us";
  if (theirs && !ours) return "only_them";
  if (!ours || !theirs) return null;
  // No verdict without both monthlies: a quote-based plan has no number to beat.
  if (ours.monthly == null || theirs.monthly == null) return null;
  const delta = ours.monthly - theirs.monthly;
  if (Math.abs(delta) < 0.01) return "same";
  return delta < 0 ? "cheaper" : "pricier";
}

/**
 * Numeric limits only compare within one meter. 100 GB against 100 credits is
 * not a comparison, and neither is a number against "unlimited" — both come back
 * null rather than inventing an equivalence. Two units the catalog does not know
 * compare only when BOTH sides omit the unit entirely (a bare count of the same
 * feature, e.g. 10 projects against 3).
 */
function limitVerdictOf(ours: FeatureSide | null, theirs: FeatureSide | null): LimitVerdict | null {
  if (!ours || !theirs) return null;
  if (ours.valueNum == null || theirs.valueNum == null) return null;
  const ourUnit = resolveMeterUnit(ours.unit);
  const theirUnit = resolveMeterUnit(theirs.unit);
  if (ourUnit || theirUnit) {
    if (!ourUnit || !theirUnit) return null;
    if (ourUnit.unit !== theirUnit.unit) return null;
  }
  if (ours.valueNum === theirs.valueNum) return "equal";
  return ours.valueNum > theirs.valueNum ? "higher" : "lower";
}

/** A row worth reading first: the two sides do not say the same thing. */
const diverges = (row: FeatureComparisonRow): boolean =>
  (row.priceVerdict != null && row.priceVerdict !== "same") ||
  row.limitVerdict === "higher" ||
  row.limitVerdict === "lower";

/**
 * Cross two captured matrices into one feature-anchored table. Returns [] when
 * neither side has a canonical row, which callers render as "no matrix captured"
 * rather than as an empty grid.
 */
export function compareEntitlements(ours: SidePlans, theirs: SidePlans): FeatureComparisonRow[] {
  const slugs: string[] = [];
  for (const cell of [...ours.cells, ...theirs.cells]) {
    if (!CANONICAL_ENTITLEMENT_SLUGS.has(cell.feature_slug)) continue;
    if (!slugs.includes(cell.feature_slug)) slugs.push(cell.feature_slug);
  }

  const rows: FeatureComparisonRow[] = [];
  for (const slug of slugs) {
    const ourPick = pickPlan(ours, slug);
    const theirPick = pickPlan(theirs, slug);
    if (!ourPick && !theirPick) continue;
    const ourSide = ourPick ? toSide(ourPick) : null;
    const theirSide = theirPick ? toSide(theirPick) : null;
    const rawKind = (ourPick ?? theirPick)?.cell.kind ?? "";
    rows.push({
      slug,
      label: featureLabel(slug),
      kind: isKnownKind(rawKind) ? rawKind : "boolean",
      ours: ourSide,
      theirs: theirSide,
      priceVerdict: priceVerdictOf(ourSide, theirSide),
      limitVerdict: limitVerdictOf(ourSide, theirSide),
    });
  }

  const order = (row: FeatureComparisonRow) => CATALOG_ORDER.get(row.slug) ?? Number.MAX_SAFE_INTEGER;
  return rows.sort(
    (a, b) => Number(diverges(b)) - Number(diverges(a)) || order(a) - order(b),
  );
}

export interface SummaryOptions {
  /** Currency the monthlies are already expressed in (the caller converts). */
  currency?: string | null;
}

const MAX_SUMMARY_LINES = 5;
const MAX_LABELS_PER_LINE = 3;

function joinLabels(rows: FeatureComparisonRow[]): string {
  const labels = rows.map((r) => r.label);
  const shown = labels.slice(0, MAX_LABELS_PER_LINE);
  const rest = labels.length - shown.length;
  if (rest > 0) return `${shown.join(", ")} and ${rest} more`;
  if (shown.length <= 1) return shown[0] ?? "";
  return `${shown.slice(0, -1).join(", ")} and ${shown[shown.length - 1] ?? ""}`;
}

const at = (side: FeatureSide, currency: string | null | undefined): string =>
  side.monthly == null ? `${side.planName} (quote-based)` : `${side.planName} (${formatPrice(side.monthly, currency ?? null)}/mo)`;

/**
 * At most five deterministic sentences over the same rows, in the register the
 * battle card already uses. Ordered by what a competitor's move costs us first:
 * what they unlock cheaper, what they list that we do not, where a limit
 * diverges, then our own advantages.
 */
export function compareSummaryLines(
  rows: readonly FeatureComparisonRow[],
  competitorName: string,
  options: SummaryOptions = {},
): string[] {
  const currency = options.currency ?? null;
  const pick = (verdict: PriceVerdict) => rows.filter((r) => r.priceVerdict === verdict);
  const lines: string[] = [];

  for (const row of pick("pricier").slice(0, 2)) {
    if (!row.ours || !row.theirs) continue;
    lines.push(
      `${competitorName} unlocks ${row.label} at ${at(row.theirs, currency)}, you at ${at(row.ours, currency)}.`,
    );
  }

  const onlyThem = pick("only_them");
  if (onlyThem.length > 0) {
    lines.push(`${competitorName} lists ${joinLabels(onlyThem)}; your pricing page does not.`);
  }

  const limitGap = rows.find((r) => r.limitVerdict === "lower" && r.ours && r.theirs);
  if (limitGap?.ours && limitGap.theirs) {
    lines.push(
      `${competitorName} gives ${limitGap.theirs.valueNum?.toLocaleString("en-US")} on ${limitGap.theirs.planName} for ${limitGap.label}, against your ${limitGap.ours.valueNum?.toLocaleString("en-US")}.`,
    );
  }

  const cheaper = pick("cheaper")[0];
  if (cheaper?.ours && cheaper.theirs) {
    lines.push(
      `You unlock ${cheaper.label} at ${at(cheaper.ours, currency)}, ${competitorName} at ${at(cheaper.theirs, currency)}.`,
    );
  }

  const onlyUs = pick("only_us");
  if (onlyUs.length > 0) {
    lines.push(`You list ${joinLabels(onlyUs)}; ${competitorName}'s pricing page does not.`);
  }

  return lines.slice(0, MAX_SUMMARY_LINES);
}
