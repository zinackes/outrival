import { describe, expect, test } from "bun:test";
import { stripMarkdown } from "./strip-markdown";

describe("stripMarkdown", () => {
  test("flattens the shape the search provider actually returns", () => {
    // Verbatim shape of the snippets audited on /dashboard/discovery (OUT-223).
    const raw = [
      "# Kilo (Kilo Code Inc.)",
      "",
      "## About",
      "Kilo Code is an open-source AI coding agent",
      "for VS Code.",
      "",
      "## Company Details",
      "- Industry: Software",
      "- Founded: 2024",
    ].join("\n");

    expect(stripMarkdown(raw)).toBe(
      "Kilo (Kilo Code Inc.). About. Kilo Code is an open-source AI coding agent for VS Code. " +
        "Company Details. Industry: Software. Founded: 2024.",
    );
  });

  test("keeps a hard-wrapped paragraph as one sentence", () => {
    expect(stripMarkdown("The platform helps teams\nship faster than before.")).toBe(
      "The platform helps teams ship faster than before.",
    );
  });

  test("drops the marker, keeps the text", () => {
    expect(stripMarkdown("### Pricing")).toBe("Pricing.");
    expect(stripMarkdown("* one\n+ two\n1. three\n2) four")).toBe("one. two. three. four.");
    expect(stripMarkdown("> Quoted claim.")).toBe("Quoted claim.");
    expect(stripMarkdown("- [x] Shipped")).toBe("Shipped.");
  });

  test("unwraps inline markup", () => {
    expect(stripMarkdown("**Bold** and _italic_ and `code`.")).toBe("Bold and italic and code.");
    expect(stripMarkdown("See [our pricing](https://x.com/pricing).")).toBe("See our pricing.");
    expect(stripMarkdown("![logo](https://x.com/logo.png) Acme")).toBe("Acme.");
    expect(stripMarkdown("Reach <https://acme.com> today.")).toBe("Reach https://acme.com today.");
    expect(stripMarkdown("~~Old name~~ New name")).toBe("Old name New name.");
    expect(stripMarkdown("Escaped \\# hash.")).toBe("Escaped # hash.");
  });

  test("leaves underscores that are not emphasis alone", () => {
    expect(stripMarkdown("Set the_api_key env var.")).toBe("Set the_api_key env var.");
  });

  test("drops rules, fences and table scaffolding", () => {
    expect(stripMarkdown("Alpha\n\n---\n\nBeta")).toBe("Alpha. Beta.");
    expect(stripMarkdown("Intro\n```js\nconst x = 1;\n```\nOutro")).toBe("Intro. Outro.");
    expect(stripMarkdown("| Plan | Price |\n| --- | --- |\n| Pro | $20 |")).toBe(
      "Plan Price. Pro $20.",
    );
  });

  test("a setext underline does not become a sentence", () => {
    expect(stripMarkdown("About\n=====\nWe build tools.")).toBe("About. We build tools.");
  });

  test("adds no punctuation where the text already ends with some", () => {
    expect(stripMarkdown("## Why us?\nBecause.")).toBe("Why us? Because.");
    expect(stripMarkdown("- Industry:\n- Software")).toBe("Industry: Software.");
  });

  test("returns an empty string for markup-only or empty input", () => {
    expect(stripMarkdown("")).toBe("");
    expect(stripMarkdown("   \n\n---\n###\n")).toBe("");
  });
});
