import { emailShell } from "./shell";
import { e, type EmailRole } from "./theme";
import { escapeHtml } from "./escape-html";

// Structural shape the digest email needs. Kept local to @outrival/shared (rather
// than importing @outrival/ai's `Digest`) so shared stays at the bottom of the
// dependency graph — the AI `Digest` and web `DigestContent` are structurally
// compatible and pass straight in.
export interface DigestEmailData {
  temperature: string;
  tldr: string[];
  sections: Array<{
    urgency: "action_required" | "watch" | "fyi";
    competitor: string;
    category: string;
    insight: string;
    so_what: string;
  }>;
  sectoralTrends?: Array<{ title: string; insight: string }>;
  // Standing queries (watched Ask questions) that materially changed this week.
  // Attached deterministically by the weekly job, like sectoralTrends.
  watchedQuestions?: Array<{ question: string; changeSummary: string }>;
}

// The urgency hue is a themed role, not a literal: the dark-mode 400/500 values
// don't clear 4.5:1 on the light canvas, so each side comes from theme.ts.
const URGENCY_META: Record<
  "action_required" | "watch" | "fyi",
  { emoji: string; label: string; role: EmailRole }
> = {
  action_required: { emoji: "🔴", label: "Action required", role: "critical" },
  watch: { emoji: "🟡", label: "Watch", role: "watch" },
  fyi: { emoji: "🟢", label: "FYI", role: "ok" },
};

export function renderDigestEmail(
  digest: DigestEmailData,
  weekStart: string,
  weekEnd: string,
  // Optional one-click feedback links (patch-21). Absent → footer without them
  // (e.g. when the signing secret or API base URL isn't configured).
  feedbackLinks?: { useful: string; notUseful: string },
  unsubscribeUrl?: string,
  // Sub-heading under the wordmark. Daily resends override the default weekly copy.
  subtitle = "Your weekly competitive briefing",
): string {
  const sectionsHtml = (["action_required", "watch", "fyi"] as const)
    .map((urgency) => {
      const items = digest.sections.filter((s) => s.urgency === urgency);
      if (items.length === 0) return "";
      const meta = URGENCY_META[urgency];
      const rows = items
        .map(
          (s) => `
  <div ${e("card", "border-radius:6px;padding:16px;margin-bottom:12px;")}>
    <div ${e("muted", "font-size:11px;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:6px;")}>${escapeHtml(s.competitor)} · ${escapeHtml(s.category)}</div>
    <div ${e("text", "font-size:14px;margin-bottom:8px;")}>${escapeHtml(s.insight)}</div>
    ${s.so_what ? `<div ${e("accent", "font-size:13px;")}>→ ${escapeHtml(s.so_what)}</div>` : ""}
  </div>`,
        )
        .join("");
      return `
<div style="margin-bottom:24px;">
  <h3 ${e(meta.role, "font-size:16px;margin:0 0 12px;")}>${meta.emoji} ${meta.label}</h3>
  ${rows}
</div>`;
    })
    .join("");

  const tldrHtml = digest.tldr
    .map((t) => `<li style="margin-bottom:6px;">${escapeHtml(t)}</li>`)
    .join("");

  // Sector trends (patch-13): a clearly separated block after the micro signals.
  const sectoral = digest.sectoralTrends ?? [];
  const sectoralHtml =
    sectoral.length === 0
      ? ""
      : `
<div ${e("rule", "margin-top:8px;margin-bottom:24px;border-top-width:1px;border-top-style:solid;padding-top:20px;")}>
  <h3 ${e("text", "font-size:16px;margin:0 0 12px;")}>🌍 Sector trends</h3>
  ${sectoral
    .map(
      (t) => `
  <div ${e("card", "border-radius:6px;padding:16px;margin-bottom:12px;")}>
    <div ${e("text", "font-size:14px;font-weight:600;margin-bottom:6px;")}>${escapeHtml(t.title)}</div>
    <div ${e("muted", "font-size:13px;")}>${escapeHtml(t.insight)}</div>
  </div>`,
    )
    .join("")}
</div>`;

  // Watched questions: standing queries whose answer materially moved this week.
  const watched = digest.watchedQuestions ?? [];
  const watchedHtml =
    watched.length === 0
      ? ""
      : `
<div ${e("rule", "margin-top:8px;margin-bottom:24px;border-top-width:1px;border-top-style:solid;padding-top:20px;")}>
  <h3 ${e("text", "font-size:16px;margin:0 0 12px;")}>👁 Your watched questions</h3>
  ${watched
    .map(
      (w) => `
  <div ${e("card", "border-radius:6px;padding:16px;margin-bottom:12px;")}>
    <div ${e("text", "font-size:14px;font-weight:600;margin-bottom:6px;")}>${escapeHtml(w.question)}</div>
    <div ${e("muted", "font-size:13px;")}>${escapeHtml(w.changeSummary)}</div>
  </div>`,
    )
    .join("")}
</div>`;

  return emailShell(
    // The wordmark now lives in the shared shell's brand header, so the digest
    // opens straight on its subtitle to avoid a duplicate "Outrival".
    `<div style="margin-bottom:24px;">
        <div ${e("muted", "font-size:12px;")}>${escapeHtml(subtitle)} · ${weekStart} → ${weekEnd}</div>
      </div>
      <div ${e("card", "border-radius:6px;padding:20px;margin-bottom:24px;")}>
        <div ${e("muted", "font-size:12px;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:8px;")}>Temperature · ${escapeHtml(digest.temperature)}</div>
        <ul ${e("text", "margin:0;padding-left:18px;font-size:14px;")}>${tldrHtml}</ul>
      </div>
      ${sectionsHtml}
      ${sectoralHtml}
      ${watchedHtml}
      ${
        feedbackLinks
          ? `<div ${e(["rule", "muted"], "margin-top:28px;border-top-width:1px;border-top-style:solid;padding-top:18px;text-align:center;font-size:13px;")}>
        Was this briefing useful?
        <a href="${feedbackLinks.useful}" ${e("ok", "text-decoration:none;margin:0 8px;")}>👍 Yes</a>
        <a href="${feedbackLinks.notUseful}" ${e("critical", "text-decoration:none;margin:0 8px;")}>👎 No</a>
      </div>`
          : ""
      }
      <div ${e("faint", "margin-top:32px;font-size:11px;text-align:center;")}>Outrival · Automated competitive intelligence${
        unsubscribeUrl
          ? ` · <a href="${unsubscribeUrl}" ${e("faint", "text-decoration:underline;")}>Unsubscribe</a>`
          : ""
      }</div>`,
    640,
  );
}

export interface AllQuietDigestData {
  pages: number;
  // Best-effort scrape_runs count for the week; 0 (unavailable or genuinely
  // idle) omits the "M times" clause below — the two cases read the same.
  checks: number;
  weekStart: string;
  weekEnd: string;
  unsubscribeUrl?: string;
}

// Lever 6 — a calm week (no signals) still gets a light briefing instead of
// going silent from the inbox where retention lives. No AI call: the copy is
// templated straight from the week's scrape counts. Reuses the same shell and
// palette as renderDigestEmail so it reads as the same product, just quieter.
export function renderAllQuietDigest({
  pages,
  checks,
  weekStart,
  weekEnd,
  unsubscribeUrl,
}: AllQuietDigestData): string {
  const pageWord = pages === 1 ? "page" : "pages";
  const checksClause = checks > 0 ? `, ${checks} time${checks === 1 ? "" : "s"}` : "";
  const copy = `We checked ${pages} ${pageWord}${checksClause} this week. No significant moves — your market was calm.`;

  return emailShell(
    `<div style="margin-bottom:24px;">
        <div ${e("muted", "font-size:12px;")}>Your weekly competitive briefing · ${weekStart} → ${weekEnd}</div>
      </div>
      <div ${e("card", "border-radius:6px;padding:20px;margin-bottom:24px;")}>
        <div ${e("muted", "font-size:12px;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:8px;")}>All quiet</div>
        <div ${e("text", "font-size:14px;line-height:1.5;")}>${escapeHtml(copy)}</div>
      </div>
      <div ${e("faint", "margin-top:32px;font-size:11px;text-align:center;")}>Outrival · Automated competitive intelligence${
        unsubscribeUrl
          ? ` · <a href="${unsubscribeUrl}" ${e("faint", "text-decoration:underline;")}>Unsubscribe</a>`
          : ""
      }</div>`,
    640,
  );
}
