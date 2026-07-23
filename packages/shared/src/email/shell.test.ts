import { describe, expect, test } from "bun:test";
import { emailShell } from "./shell";
import { e, darkRules, EMAIL_DARK, EMAIL_LIGHT } from "./theme";

// These lock the mechanics an email theme depends on. Each one, if it silently
// regressed, would ship a broken render to an inbox with no way to see it first.
describe("emailShell", () => {
  const html = emailShell("<p>body</p>");

  test("declares support for BOTH schemes, so supporting clients stop inverting", () => {
    expect(html).toContain('<meta name="color-scheme" content="light dark"');
    expect(html).toContain('<meta name="supported-color-schemes" content="light dark"');
    expect(html).toContain("color-scheme: light dark");
  });

  test("authors light: the canvas is the light color as CSS *and* as bgcolor", () => {
    // The attribute is what webmail clients that drop <body> backgrounds honor.
    expect(html).toContain(`bgcolor="${EMAIL_LIGHT.canvas}"`);
    expect(html).toContain(`background-color:${EMAIL_LIGHT.canvas}`);
  });

  test("carries the dark override for media-query clients AND the Outlook apps", () => {
    expect(html).toContain("@media (prefers-color-scheme: dark)");
    expect(html).toContain("[data-ogsc] .e-text");
    expect(html).toContain("[data-ogsb] .e-bg");
    expect(html).toContain(EMAIL_DARK.canvas);
  });

  test("every dark declaration is !important — inline styles win otherwise", () => {
    // A <style> rule cannot beat an inline style="" attribute without it, and
    // every themed element carries its light style inline.
    const declarations = darkRules()
      .split("}")
      .filter((r) => r.includes("{") && !r.includes("display:none"))
      .map((r) => r.split("{")[1] ?? "");
    for (const decl of declarations) {
      for (const prop of decl.split(";").filter(Boolean)) {
        expect(prop).toContain("!important");
      }
    }
  });

  test("ships both logo inks, dark-ink shown by default", () => {
    // The default must be correct on the light canvas: clients that force their
    // own dark mode (the Gmail apps) never apply our swap.
    expect(html).toContain('class="e-logo-l" src="https://outrival.app/logo-dark.png"');
    expect(html).toContain("https://outrival.app/logo-light.png");
    expect(html).toContain('class="e-logo-d" style="display:none;');
    expect(darkRules()).toContain(".e-logo-l{display:none !important;}");
  });
});

describe("e()", () => {
  test("emits the class hook and the light inline style together", () => {
    expect(e("text")).toBe(`class="e-text" style="color:${EMAIL_LIGHT.text};"`);
  });

  test("composes roles and appends layout css that carries no color", () => {
    const out = e(["card", "text"], "padding:14px;");
    expect(out).toContain('class="e-card e-text"');
    expect(out).toContain(`background-color:${EMAIL_LIGHT.surface}`);
    expect(out).toContain(`color:${EMAIL_LIGHT.text}`);
    expect(out).toContain("padding:14px;");
  });
});
