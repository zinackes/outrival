// Email templates interpolate AI-generated text derived from scraped competitor
// pages — attacker-influenced content. Escape every dynamic value before it
// lands in HTML so a prompt-injected payload can't render markup in the inbox.
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
