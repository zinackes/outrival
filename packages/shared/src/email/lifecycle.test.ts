import { describe, expect, test } from "bun:test";
import {
  renderCelebrationEmail,
  renderMonthlyRecapEmail,
  renderWelcomeEmail,
} from "./lifecycle";

// ux:45 — the three lifecycle emails ship to the same address as the digests and are
// gated on the same organizations.digestEnabled flag, so each has to offer the same
// one-click way out. Before this, an inbox could only stop them by replying to
// support. The degradation contract matches renderDigestEmail's: no URL, no footer.

const WELCOME = { competitorNames: ["Linear"], dashboardUrl: "https://outrival.app/dashboard" };
const CELEBRATION = {
  competitorName: "Linear",
  category: "pricing",
  insight: "Business moved to $20 per seat.",
  soWhat: null,
  signalUrl: "https://outrival.app/dashboard/signals",
};
const RECAP = {
  monthLabel: "June 2026",
  totalMoves: 12,
  competitorsTracked: 3,
  busiestName: "Linear",
  biggestInsight: null,
  recapUrl: "https://outrival.app/dashboard/recap",
};

const UNSUB = "https://api.outrival.app/api/digest-feedback/unsubscribe?token=abc.def";

const RENDERERS = [
  ["welcome", () => renderWelcomeEmail({ ...WELCOME, unsubscribeUrl: UNSUB }), () => renderWelcomeEmail(WELCOME)],
  [
    "celebration",
    () => renderCelebrationEmail({ ...CELEBRATION, unsubscribeUrl: UNSUB }),
    () => renderCelebrationEmail(CELEBRATION),
  ],
  [
    "monthly recap",
    () => renderMonthlyRecapEmail({ ...RECAP, unsubscribeUrl: UNSUB }),
    () => renderMonthlyRecapEmail(RECAP),
  ],
] as const;

describe("lifecycle emails — unsubscribe footer", () => {
  for (const [name, withUrl, withoutUrl] of RENDERERS) {
    test(`${name} links the unsubscribe URL when one is given`, () => {
      const { html } = withUrl();
      expect(html).toContain(`href="${UNSUB}"`);
      expect(html).toContain(">Unsubscribe</a>");
    });

    test(`${name} renders no footer without a URL`, () => {
      const { html } = withoutUrl();
      expect(html).not.toContain("Unsubscribe");
    });
  }

  test("the URL is escaped into the href", () => {
    const { html } = renderWelcomeEmail({
      ...WELCOME,
      unsubscribeUrl: 'https://x.test/u?t=a"><script>alert(1)</script>',
    });
    expect(html).not.toContain("<script>");
    expect(html).toContain("&quot;&gt;&lt;script&gt;");
  });
});

describe("lifecycle emails — subject lines", () => {
  // ux:19 — an em dash renders as a mystery glyph in several inbox clients and reads
  // as machine copy in the ones that do render it. Rephrase, never swap in a hyphen.
  for (const [name, withUrl] of RENDERERS) {
    test(`${name} subject carries no em dash`, () => {
      expect(withUrl().subject).not.toContain("—");
    });
  }
});
