import { describe, expect, test } from "bun:test";
import { renderCodeBox } from "../src/lib/sign-in-email";

// code:SEC-05 — every value interpolated into email HTML is escaped. The sign-in code
// is a Better Auth OTP (digits), so this is a runtime no-op today; the test is what
// keeps it one if the box is ever reused for a value that is not.

describe("renderCodeBox", () => {
  test("escapes the code", () => {
    const html = renderCodeBox('<img src=x onerror="alert(1)">');
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
  });

  test("renders a real OTP unchanged", () => {
    expect(renderCodeBox("483012")).toContain(">483012</div>");
  });
});
