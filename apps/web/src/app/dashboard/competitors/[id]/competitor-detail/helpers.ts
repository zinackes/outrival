// Pure, JSX-free helpers shared across the competitor-detail tabs. No React, no
// app-local type coupling — safe to import from any tab module.

export type DiffLine = { kind: "add" | "remove"; text: string };

export function parseDiff(
  diffText: string,
  maxLines = 18,
): { lines: DiffLine[]; truncated: boolean } {
  const lines: DiffLine[] = [];
  for (const raw of diffText.split("\n")) {
    const trimmed = raw.trimEnd();
    if (!trimmed) continue;
    const kind: "add" | "remove" | null =
      trimmed.startsWith("+ ") ? "add" : trimmed.startsWith("- ") ? "remove" : null;
    if (!kind) continue;
    const text = stripHtml(trimmed.slice(2)).trim();
    if (!text) continue;
    lines.push({ kind, text });
    if (lines.length >= maxLines) break;
  }
  return { lines, truncated: lines.length >= maxLines };
}

export function stripHtml(input: string): string {
  return input
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ");
}

export function formatTierPrice(p: {
  price: number;
  currency: string;
  billing_period: string;
}): string {
  if (p.price === 0) return "Free";
  const sym =
    p.currency === "USD" ? "$" : p.currency === "EUR" ? "€" : p.currency === "GBP" ? "£" : "";
  const amount = sym ? `${sym}${p.price}` : `${p.price} ${p.currency}`;
  const per =
    p.billing_period === "monthly" ? "/mo" : p.billing_period === "yearly" ? "/yr" : "";
  return `${amount}${per}`;
}

// A captured customer logo carries a brand name (from <img alt>) and/or a resolved
// absolute image URL (`src`). Prefer rendering the real logo image — it reads far
// better than a text badge — and fall back to the name only when there's no usable
// image (no src, a non-absolute src, or the image failed to load).
export function isRenderableLogoSrc(value: string): boolean {
  return /^(https?:\/\/|data:image\/)/i.test(value.trim());
}

export function logoLabel(value: string): string {
  const v = value.trim();
  if (!v || /^data:/i.test(v)) return "";
  const looksLikePath =
    /^(https?:|\/\/|\/|\.\.?\/)/i.test(v) ||
    /\.(png|jpe?g|svg|webp|gif|avif|ico)(\?|#|$)/i.test(v);
  if (!looksLikePath) return v; // already a brand name (alt text)
  const file = (v.split(/[?#]/)[0] ?? v).split("/").filter(Boolean).pop() ?? v;
  return file
    .replace(/\.(png|jpe?g|svg|webp|gif|avif|ico)$/i, "")
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Seniority ordering (low→high) so a role list surfaces the senior bets first.
// Keys match the canonical buckets the ATS resolver emits (packages/scrapers jobs/ats).
export const SENIORITY_RANK: Record<string, number> = {
  executive: 8,
  lead: 7,
  principal: 6,
  staff: 5,
  senior: 4,
  mid: 3,
  junior: 2,
  intern: 1,
};

// Rank at/above which a role counts as a "senior+" bet (senior, staff, principal,
// lead, executive) — a leading indicator of a serious build.
export const SENIOR_PLUS_THRESHOLD = 4;

export function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

const CURRENCY_SYMBOL: Record<string, string> = { USD: "$", EUR: "€", GBP: "£", INR: "₹" };

// Compact money for a hiring badge, e.g. 120000 USD → "$120k".
export function formatMoney(n: number, currency: string | null): string {
  const sym = CURRENCY_SYMBOL[currency ?? ""] ?? "";
  const compact = n >= 1000 ? `${Math.round(n / 1000)}k` : String(Math.round(n));
  if (sym) return `${sym}${compact}`;
  return currency ? `${compact} ${currency}` : compact;
}

// Salary range label for one role, or null when the ATS exposed no compensation.
export function salaryLabel(r: {
  salaryMin: number | null;
  salaryMax: number | null;
  salaryCurrency: string | null;
}): string | null {
  if (r.salaryMin == null && r.salaryMax == null) return null;
  if (r.salaryMin != null && r.salaryMax != null && r.salaryMin !== r.salaryMax) {
    return `${formatMoney(r.salaryMin, r.salaryCurrency)}–${formatMoney(r.salaryMax, r.salaryCurrency)}`;
  }
  return formatMoney((r.salaryMin ?? r.salaryMax)!, r.salaryCurrency);
}
