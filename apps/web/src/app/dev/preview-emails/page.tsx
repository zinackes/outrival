import type { Metadata } from "next";
import { notFound } from "next/navigation";
import {
  renderAllQuietDigest,
  renderCelebrationEmail,
  renderDigestEmail,
  renderMonthlyRecapEmail,
  renderWelcomeEmail,
} from "@outrival/shared";

// Dev-only preview of the transactional emails, side by side in both color
// schemes. Emails are the one surface we ship blind — no local render, and a
// mistake is only visible once it has landed in someone's inbox.
export const metadata: Metadata = {
  title: "Email preview (dev)",
  robots: { index: false, follow: false },
};

// An iframe inherits the OS color scheme, so the dark column can't be produced
// by CSS alone. Promoting the shell's dark block to an unconditional one renders
// exactly what a dark client applies — same rules, same !important, same order.
function forceDark(html: string): string {
  return html.replace("@media (prefers-color-scheme: dark) {", "@media all {");
}

const SAMPLES: Array<{ name: string; html: string }> = [
  {
    name: "Weekly digest",
    html: renderDigestEmail(
      {
        temperature: "high",
        tldr: [
          "Linear shipped usage-based pricing on the Business tier.",
          "Notion is hiring 6 enterprise AEs in EMEA.",
        ],
        sections: [
          {
            urgency: "action_required",
            competitor: "Linear",
            category: "pricing",
            insight: "Business tier moved from $16 to $20 per seat, with AI credits bundled.",
            so_what: "Your $18 tier is no longer the mid-market anchor — revisit before renewals.",
          },
          {
            urgency: "watch",
            competitor: "Notion",
            category: "hiring",
            insight: "Six enterprise AE openings across London and Berlin.",
            so_what: "An EMEA enterprise push is starting one to two quarters out.",
          },
          {
            urgency: "fyi",
            competitor: "Height",
            category: "content",
            insight: "Published a comparison page targeting three competitors.",
            so_what: "",
          },
        ],
        sectoralTrends: [
          {
            title: "AI credits are becoming a pricing axis",
            insight: "Three tracked competitors now meter AI usage separately from seats.",
          },
        ],
        watchedQuestions: [
          {
            question: "Who undercuts us on the entry tier?",
            changeSummary: "Linear left the bracket; Height is now the only one below you.",
          },
        ],
      },
      "2026-07-13",
      "2026-07-20",
      { useful: "#", notUseful: "#" },
      "#",
    ),
  },
  {
    name: "All-quiet digest",
    html: renderAllQuietDigest({
      pages: 42,
      checks: 310,
      weekStart: "2026-07-13",
      weekEnd: "2026-07-20",
      unsubscribeUrl: "#",
    }),
  },
  {
    name: "Welcome (D0)",
    html: renderWelcomeEmail({
      competitorNames: ["Linear", "Notion", "Height", "Shortcut"],
      dashboardUrl: "#",
    }).html,
  },
  {
    name: "First-change celebration",
    html: renderCelebrationEmail({
      competitorName: "Linear",
      category: "pricing",
      insight: "Business tier moved from $16 to $20 per seat, with AI credits bundled.",
      soWhat: "Your $18 tier is no longer the mid-market anchor.",
      signalUrl: "#",
    }).html,
  },
  {
    name: "Monthly recap teaser",
    html: renderMonthlyRecapEmail({
      monthLabel: "June 2026",
      totalMoves: 37,
      competitorsTracked: 9,
      busiestName: "Linear",
      biggestInsight: "Linear bundled AI credits into its Business tier.",
      recapUrl: "#",
    }).html,
  },
];

export default function EmailPreviewPage() {
  if (
    process.env.NODE_ENV === "production" &&
    process.env.PRODUCT_PREVIEW_ENABLED !== "1"
  ) {
    notFound();
  }

  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <h1 className="text-title font-semibold">Email preview</h1>
      <p className="text-muted-foreground mt-2 mb-8 text-sm">
        Left column is what every client renders by default. Right column is the{" "}
        <code>prefers-color-scheme: dark</code> override, forced on. Templates sent
        from the workers (alert, daily briefing, silent monitor, watched question,
        structural change) share this shell and these classes.
      </p>

      {SAMPLES.map((sample) => (
        <section key={sample.name} className="mb-12">
          <h2 className="mb-3 text-lg font-medium">{sample.name}</h2>
          <div className="grid gap-4 md:grid-cols-2">
            {(["Light", "Dark"] as const).map((mode) => (
              <div key={mode}>
                <div className="text-muted-foreground mb-2 text-meta uppercase tracking-wider">
                  {mode}
                </div>
                <iframe
                  title={`${sample.name} — ${mode}`}
                  srcDoc={mode === "Dark" ? forceDark(sample.html) : sample.html}
                  className="border-border h-[720px] w-full rounded-lg border"
                />
              </div>
            ))}
          </div>
        </section>
      ))}
    </main>
  );
}
