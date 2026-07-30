// Compact money and salary labels. Lived in the competitor-detail helpers until a
// third consumer appeared outside that route (the signal Evidence fact block), and
// a component may not import from an app route.

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
