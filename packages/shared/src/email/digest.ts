import { emailButton, emailShell } from "./shell";
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
//
// Labels mirror URGENCY_META in apps/web/src/lib/digest-shape.ts (shared can't
// import from an app). A brief tells you what to do about a week, so the buckets
// are phrased as decisions; the emoji headers are gone, since a coloured heading
// already carries the band and emoji-as-UI reads as a template, not a briefing.
const URGENCY_META: Record<
  "action_required" | "watch" | "fyi",
  { label: string; role: EmailRole }
> = {
  action_required: { label: "Needs an answer", role: "critical" },
  watch: { label: "Worth watching", role: "watch" },
  fyi: { label: "Noted", role: "muted" },
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
  // CTA back into the app (patch-20 measurement). Absent → no button, same
  // degradation contract as feedbackLinks/unsubscribeUrl.
  readUrl?: string,
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
    <div ${e("muted", "font-size:13px;margin-bottom:6px;")}>${escapeHtml(s.competitor)} · ${escapeHtml(s.category.replace(/_/g, " "))}</div>
    <div ${e("text", "font-size:15px;line-height:1.5;margin-bottom:8px;")}>${escapeHtml(s.insight)}</div>
    ${s.so_what ? `<div ${e("muted", "font-size:14px;line-height:1.5;")}>→ ${escapeHtml(s.so_what)}</div>` : ""}
  </div>`,
        )
        .join("");
      return `
<div style="margin-bottom:24px;">
  <h3 ${e(meta.role, "font-size:15px;margin:0 0 12px;")}>${meta.label} (${items.length})</h3>
  ${rows}
</div>`;
    })
    .join("");

  // The model already writes the week's verdict as its first TL;DR point, so the
  // email opens on that sentence instead of on a "Temperature" label.
  const [headline, ...rest] = digest.tldr;
  const supportingHtml = rest
    .map(
      (t) =>
        `<li style="margin-bottom:6px;line-height:1.5;">${escapeHtml(t)}</li>`,
    )
    .join("");
  const moves = digest.sections.length;
  const needAnswer = digest.sections.filter((s) => s.urgency === "action_required").length;
  const facts = [
    `${moves} move${moves === 1 ? "" : "s"}`,
    `${needAnswer} need${needAnswer === 1 ? "s" : ""} an answer`,
    `activity ${digest.temperature}`,
  ].join(" · ");

  // Sector trends (patch-13): a clearly separated block after the micro signals.
  const sectoral = digest.sectoralTrends ?? [];
  const sectoralHtml =
    sectoral.length === 0
      ? ""
      : `
<div ${e("rule", "margin-top:8px;margin-bottom:24px;border-top-width:1px;border-top-style:solid;padding-top:20px;")}>
  <h3 ${e("text", "font-size:15px;margin:0 0 12px;")}>Sector trends</h3>
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
  <h3 ${e("text", "font-size:15px;margin:0 0 12px;")}>Your watched questions</h3>
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
    `<div style="margin-bottom:20px;">
        <div ${e("muted", "font-size:13px;")}>${escapeHtml(subtitle)} · ${weekStart} to ${weekEnd}</div>
      </div>
      ${
        headline
          ? `<h1 ${e("text", "font-size:21px;line-height:1.3;font-weight:600;margin:0 0 16px;")}>${escapeHtml(headline)}</h1>`
          : ""
      }
      ${
        supportingHtml
          ? `<ul ${e("muted", "margin:0 0 16px;padding-left:18px;font-size:15px;")}>${supportingHtml}</ul>`
          : ""
      }
      <div ${e(["rule", "muted"], "border-top-width:1px;border-top-style:solid;border-bottom-width:1px;border-bottom-style:solid;padding:10px 0;margin-bottom:24px;font-size:13px;")}>${escapeHtml(facts)}</div>
      ${sectionsHtml}
      ${sectoralHtml}
      ${watchedHtml}
      ${
        readUrl
          ? `<div style="margin-top:28px;text-align:center;">${emailButton(readUrl, "Open the full briefing")}</div>`
          : ""
      }
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
  // CTA back into the app (patch-20 measurement). Absent → no button.
  readUrl?: string;
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
  readUrl,
}: AllQuietDigestData): string {
  const pageWord = pages === 1 ? "page" : "pages";
  const checksClause = checks > 0 ? `, ${checks} time${checks === 1 ? "" : "s"}` : "";
  const copy = `We checked ${pages} ${pageWord}${checksClause} this week. No significant moves. Your market was calm.`;

  return emailShell(
    `<div style="margin-bottom:24px;">
        <div ${e("muted", "font-size:12px;")}>Your weekly competitive briefing · ${weekStart} → ${weekEnd}</div>
      </div>
      <div ${e("card", "border-radius:6px;padding:20px;margin-bottom:24px;")}>
        <div ${e("muted", "font-size:13px;margin-bottom:8px;")}>All quiet</div>
        <div ${e("text", "font-size:15px;line-height:1.5;")}>${escapeHtml(copy)}</div>
      </div>
      ${
        readUrl
          ? `<div style="margin-top:28px;text-align:center;">${emailButton(readUrl, "See what we checked")}</div>`
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
