import { describe, expect, test } from "bun:test";
import {
  nameCompetitor,
  signalTitle,
  signalTier,
  TITLE_MAX,
} from "../src/lib/signal-shape";

const sig = (insight: string, competitorName = "JFrog") => ({
  insight,
  competitorName,
});

describe("signalTitle", () => {
  test("drops the generic subject the row already shows", () => {
    expect(signalTitle(sig("The competitor's page now lists 6 open positions"))).toBe(
      "Now lists 6 open positions",
    );
  });

  test("drops the competitor's own name and its surface noun", () => {
    expect(
      signalTitle(sig("JFrog's careers page now lists 6 open positions")),
    ).toBe("Now lists 6 open positions");
  });

  test("matches the competitor name case-insensitively", () => {
    expect(signalTitle(sig("jfrog added a Pro tier", "JFrog"))).toBe(
      "Added a Pro tier",
    );
  });

  test("keeps only the first sentence", () => {
    expect(
      signalTitle(sig("Pricing moved to $14 per seat. This is the third cut.")),
    ).toBe("Pricing moved to $14 per seat");
  });

  test("does not split on the period inside a figure", () => {
    expect(signalTitle(sig("Pro plan is now $14.00 per seat"))).toBe(
      "Pro plan is now $14.00 per seat",
    );
  });

  test("cuts the trailing qualifier that restates the change", () => {
    expect(
      signalTitle(
        sig(
          "The competitor's page now lists 6 open positions, after removing the previous statement of 5 open positions.",
        ),
      ),
    ).toBe("Now lists 6 open positions");
  });

  test("keeps the previous value when the sentence carries it", () => {
    expect(signalTitle(sig("Pro plan is $14 per seat, up from $16"))).toBe(
      "Pro plan is $14 per seat, up from $16",
    );
  });

  test("cuts a long title at a break the sentence already offers", () => {
    const title = signalTitle(
      sig(
        "The competitor's page now lists 6 open positions and adds an Operations role with 1 open position, after removing the previous statement of 5 open positions.",
      ),
    );
    expect(title).toBe("Now lists 6 open positions and adds an Operations role");
    expect(title.length).toBeLessThanOrEqual(TITLE_MAX);
  });

  test("falls back to an ellipsis when there is no break to cut on", () => {
    const title = signalTitle(
      sig(
        "Rewrote every headline across the entire marketing site in one coordinated pass",
      ),
    );
    expect(title.endsWith("…")).toBe(true);
    expect(title.length).toBeLessThanOrEqual(TITLE_MAX + 1);
  });

  test("never cuts a short sentence down to a fragment", () => {
    expect(signalTitle(sig("Added SOC 2, which the trust page now shows"))).toBe(
      "Added SOC 2, which the trust page now shows",
    );
  });

  test("collapses the whitespace the model leaves in", () => {
    expect(signalTitle(sig("  Added   a  Pro tier\n"))).toBe("Added a Pro tier");
  });

  test("a competitor name with regex characters is matched literally", () => {
    expect(signalTitle(sig("C++ Corp. raised a Series B", "C++ Corp."))).toBe(
      "Raised a Series B",
    );
  });

  test("an empty insight never renders an empty row", () => {
    expect(signalTitle(sig("   "))).toBe("Signal");
  });

  test("names the competitor the model left generic mid-sentence", () => {
    expect(signalTitle(sig("Pricing dropped on the competitor's Pro plan"))).toBe(
      "Pricing dropped on JFrog's Pro plan",
    );
  });
});

describe("nameCompetitor", () => {
  test("replaces the generic subject with the name", () => {
    expect(nameCompetitor("The competitor now undercuts us", "JFrog")).toBe(
      "JFrog now undercuts us",
    );
  });

  test("keeps the possessive", () => {
    expect(nameCompetitor("Cuts into the competitor's free tier", "JFrog")).toBe(
      "Cuts into JFrog's free tier",
    );
  });

  test("handles the typographic apostrophe the model writes", () => {
    expect(nameCompetitor("The competitor’s page changed", "JFrog")).toBe(
      "JFrog's page changed",
    );
  });

  test("replaces every occurrence, not just the first", () => {
    expect(
      nameCompetitor("The competitor raised the competitor's floor price", "JFrog"),
    ).toBe("JFrog raised JFrog's floor price");
  });

  test("leaves the common noun alone", () => {
    const text = "A new competitor entered the space, and competitors are cutting";
    expect(nameCompetitor(text, "JFrog")).toBe(text);
  });

  test("a missing name leaves the text untouched", () => {
    expect(nameCompetitor("The competitor shipped SSO", "  ")).toBe(
      "The competitor shipped SSO",
    );
  });
});

describe("signalTier", () => {
  test("critical and high need an answer", () => {
    expect(signalTier({ severity: "critical", severityOverride: null })).toBe(
      "action_required",
    );
    expect(signalTier({ severity: "high", severityOverride: null })).toBe(
      "action_required",
    );
  });

  test("medium is worth watching, low is noted", () => {
    expect(signalTier({ severity: "medium", severityOverride: null })).toBe("watch");
    expect(signalTier({ severity: "low", severityOverride: null })).toBe("fyi");
  });

  test("a user override wins over the classified severity", () => {
    expect(signalTier({ severity: "critical", severityOverride: "low" })).toBe("fyi");
  });
});
