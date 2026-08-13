import { emailButton, emailSectionHead, emailShell, type EmailSeverity } from "./shell";
import { e, t, type EmailRole } from "./theme";
import { escapeHtml } from "./escape-html";
import { storySummary, type CompetitorStory } from "../memory/competitor-memory";

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
  // Accumulated memory (OUT-172): what the reader knows about a competitor over the
  // whole tracking period, not just this week. Built by buildCompetitorMemory and
  // attached deterministically, same pattern again — no AI call, no new prose.
  competitorStories?: CompetitorStory[];
  /** Eligible competitors the cap left out, rendered as a "+N more" line. */
  competitorStoriesOmitted?: number;
}

// The urgency hue is a themed role, not a literal: the dark-mode 400/500 values
// don't clear 4.5:1 on the light canvas, so each side comes from theme.ts. The
// roles are the product's own severity steps — an urgency band and a signal
// severity are the same scale, and used to be two.
//
// Labels mirror URGENCY_META in apps/web/src/lib/digest-shape.ts (shared can't
// import from an app). A brief tells you what to do about a week, so the buckets
// are phrased as decisions; the emoji headers are gone, since a coloured heading
// already carries the band and emoji-as-UI reads as a template, not a briefing.
const URGENCY_META: Record<
  "action_required" | "watch" | "fyi",
  { label: string; role: EmailRole; severity: EmailSeverity }
> = {
  action_required: { label: "Needs an answer", role: "critical", severity: "critical" },
  watch: { label: "Worth watching", role: "medium", severity: "medium" },
  fyi: { label: "Noted", role: "low", severity: "low" },
};

// One signal, boxless: a hairline above every row but the first, instead of a
// bordered card per item. Three groups of identical cards gave the week no shape
// — "Needs an answer" and "Noted" rendered the same weight (DESIGN.md §5).
function signalRow(
  s: DigestEmailData["sections"][number],
  isFirst: boolean,
): string {
  const divider = isFirst
    ? ""
    : "margin-top:14px;padding-top:14px;border-top-width:1px;border-top-style:solid;";
  return `
  <div ${e("rule", divider)}>
    <div ${e("muted", t("dense", "margin-bottom:5px;"))}>${escapeHtml(s.competitor)} · ${escapeHtml(s.category.replace(/_/g, " "))}</div>
    <div ${e("text", t("lead", "margin-bottom:6px;"))}>${escapeHtml(s.insight)}</div>
    ${s.so_what ? `<div ${e("muted", t("body"))}>→ ${escapeHtml(s.so_what)}</div>` : ""}
  </div>`;
}

// Trends and watched questions share one shape: a bold line over a muted one.
function pairRow(title: string, detail: string, isFirst: boolean): string {
  const divider = isFirst
    ? ""
    : "margin-top:14px;padding-top:14px;border-top-width:1px;border-top-style:solid;";
  return `
  <div ${e("rule", divider)}>
    <div ${e("text", t("body", "font-weight:600;margin-bottom:4px;"))}>${escapeHtml(title)}</div>
    <div ${e("muted", t("body"))}>${escapeHtml(detail)}</div>
  </div>`;
}

// One competitor's accumulated history: who, how far back, then the dated facts in
// the order they happened. Same boxless run of rows as the week's signals, so the
// block reads as another part of the brief rather than as an attachment.
function storyBlock(story: CompetitorStory, isFirst: boolean): string {
  const divider = isFirst
    ? ""
    : "margin-top:18px;padding-top:18px;border-top-width:1px;border-top-style:solid;";
  const facts = story.facts
    .map(
      (f) => `
    <div style="margin-top:8px;">
      <div ${e("faint", t("meta", "margin-bottom:3px;letter-spacing:normal;"))}>${escapeHtml(f.ago)} · ${escapeHtml(f.category.replace(/_/g, " "))}</div>
      <div ${e("text", t("body"))}>${
        f.before
          ? `${escapeHtml(f.before)} <span ${e("faint")}>&rarr;</span> ${escapeHtml(f.after)}`
          : escapeHtml(f.after)
      }</div>
    </div>`,
    )
    .join("");
  return `
  <div ${e("rule", divider)}>
    <div ${e("text", t("body", "font-weight:600;"))}>${escapeHtml(story.competitor)}</div>
    <div ${e("muted", t("meta", "margin-top:2px;letter-spacing:normal;"))}>${escapeHtml(storySummary(story))}</div>
    ${facts}
  </div>`;
}

/**
 * "What you know now" — the accumulated memory block (OUT-172).
 *
 * The rest of a brief is about the last seven days; this is the only part that
 * compounds, which is also why it renders in the all-quiet email: a calm week is
 * exactly when "nothing moved" needs to be read next to everything that did.
 * Empty (no competitor over the threshold) renders nothing at all.
 */
function memoryHtml(stories: CompetitorStory[], omitted: number): string {
  if (stories.length === 0) return "";
  const more =
    omitted > 0
      ? `<div ${e("faint", t("meta", "margin-top:16px;letter-spacing:normal;"))}>+${omitted} more competitor${omitted === 1 ? "" : "s"} with a history on file</div>`
      : "";
  return `
<div style="margin-bottom:28px;">
  ${emailSectionHead("What you know now", "text")}
  ${stories.map((s, i) => storyBlock(s, i === 0)).join("")}
  ${more}
</div>`;
}

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
      const rows = items.map((s, i) => signalRow(s, i === 0)).join("");
      return `
<div style="margin-bottom:28px;">
  ${emailSectionHead(`${meta.label} (${items.length})`, meta.role, meta.severity)}
  ${rows}
</div>`;
    })
    .join("");

  // The model already writes the week's verdict as its first TL;DR point, so the
  // email opens on that sentence instead of on a "Temperature" label.
  const [headline, ...rest] = digest.tldr;
  const supportingHtml = rest
    .map((line) => `<li style="margin-bottom:8px;">${escapeHtml(line)}</li>`)
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
<div style="margin-bottom:28px;">
  ${emailSectionHead("Sector trends", "text")}
  ${sectoral.map((s, i) => pairRow(s.title, s.insight, i === 0)).join("")}
</div>`;

  // Watched questions: standing queries whose answer materially moved this week.
  const watched = digest.watchedQuestions ?? [];
  const watchedHtml =
    watched.length === 0
      ? ""
      : `
<div style="margin-bottom:28px;">
  ${emailSectionHead("Your watched questions", "text")}
  ${watched.map((w, i) => pairRow(w.question, w.changeSummary, i === 0)).join("")}
</div>`;

  return emailShell(
    // The wordmark now lives in the shared shell's brand header, so the digest
    // opens straight on its subtitle to avoid a duplicate "Outrival".
    `<div ${e("muted", t("meta", "margin-bottom:10px;"))}>${escapeHtml(subtitle)} · ${weekStart} to ${weekEnd}</div>
      ${
        headline
          ? `<h1 ${e("text", t("display", "margin:0 0 14px;"))}>${escapeHtml(headline)}</h1>`
          : ""
      }
      ${
        supportingHtml
          ? `<ul ${e("muted", t("body", "margin:0 0 20px;padding-left:18px;"))}>${supportingHtml}</ul>`
          : ""
      }
      <div ${e(["panel", "muted"], t("dense", "border-radius:6px;padding:11px 14px;margin-bottom:28px;font-variant-numeric:tabular-nums;"))}>${escapeHtml(facts)}</div>
      ${sectionsHtml}
      ${sectoralHtml}
      ${watchedHtml}
      ${memoryHtml(digest.competitorStories ?? [], digest.competitorStoriesOmitted ?? 0)}
      ${
        readUrl
          ? `<div style="margin-top:4px;margin-bottom:4px;">${emailButton(readUrl, "Open the full briefing")}</div>`
          : ""
      }
      ${
        feedbackLinks
          ? `<div ${e(["rule", "muted"], t("dense", "margin-top:28px;border-top-width:1px;border-top-style:solid;padding-top:18px;"))}>
        Was this briefing useful?
        <a href="${feedbackLinks.useful}" ${e(["rule", "positive"], "display:inline-block;text-decoration:none;font-weight:600;padding:4px 12px;margin-left:8px;border-radius:4px;border-width:1px;border-style:solid;")}>Yes</a>
        <a href="${feedbackLinks.notUseful}" ${e(["rule", "muted"], "display:inline-block;text-decoration:none;font-weight:600;padding:4px 12px;margin-left:6px;border-radius:4px;border-width:1px;border-style:solid;")}>No</a>
      </div>`
          : ""
      }
      <div ${e("faint", t("meta", "margin-top:32px;letter-spacing:normal;"))}>Outrival · Automated competitive intelligence${
        unsubscribeUrl
          ? ` · <a href="${unsubscribeUrl}" ${e("faint", "text-decoration:underline;")}>Unsubscribe</a>`
          : ""
      }</div>`,
    640,
    headline,
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
  // Accumulated memory (OUT-172). A quiet week is precisely the one that reads as
  // "is this even running?", so the block that compounds belongs here first.
  competitorStories?: CompetitorStory[];
  competitorStoriesOmitted?: number;
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
  competitorStories,
  competitorStoriesOmitted,
}: AllQuietDigestData): string {
  const pageWord = pages === 1 ? "page" : "pages";
  const checksClause = checks > 0 ? `, ${checks} time${checks === 1 ? "" : "s"}` : "";
  const copy = `We checked ${pages} ${pageWord}${checksClause} this week. No significant moves. Your market was calm.`;
  const memory = memoryHtml(competitorStories ?? [], competitorStoriesOmitted ?? 0);

  return emailShell(
    // The one email that IS a single statement keeps its card: there is one
    // object to look at, so a panel reads better than a boxless run of rows.
    `<div ${e("muted", t("meta", "margin-bottom:10px;"))}>Your weekly competitive briefing · ${weekStart} → ${weekEnd}</div>
      <div ${e("card", "border-radius:6px;padding:20px;margin-bottom:24px;")}>
        <div style="margin-bottom:10px;"><span ${e("dotPositive", "display:inline-block;width:8px;height:8px;border-radius:2px;vertical-align:middle;margin-right:8px;")}></span><span ${e("positive", t("heading", "vertical-align:middle;"))}>All quiet</span></div>
        <div ${e("text", t("lead"))}>${escapeHtml(copy)}</div>
      </div>
      ${memory}
      ${readUrl ? `<div style="margin-top:4px;">${emailButton(readUrl, "See what we checked")}</div>` : ""}
      <div ${e("faint", t("meta", "margin-top:32px;letter-spacing:normal;"))}>Outrival · Automated competitive intelligence${
        unsubscribeUrl
          ? ` · <a href="${unsubscribeUrl}" ${e("faint", "text-decoration:underline;")}>Unsubscribe</a>`
          : ""
      }</div>`,
    640,
    copy,
  );
}
