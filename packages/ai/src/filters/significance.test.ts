import { describe, expect, it } from "bun:test";
import { evaluateSignificance } from "./significance";

describe("evaluateSignificance", () => {
  it("skips an empty diff", () => {
    const r = evaluateSignificance({ added: "", removed: "" });
    expect(r.worth).toBe(false);
    expect(r.reason).toBe("too_short");
  });

  it("skips a tiny diff", () => {
    const r = evaluateSignificance({ added: "v1.0.1", removed: "v1.0.0" });
    expect(r.worth).toBe(false);
  });

  it("skips a short hash diff (caught as too short)", () => {
    const r = evaluateSignificance({
      added: "a1b2c3d4e5f60718293a4b5c6d7e8f90",
      removed: "",
    });
    expect(r.worth).toBe(false);
  });

  it("skips a timestamp-only diff", () => {
    const r = evaluateSignificance({
      added: "2026-06-01T10:24:00Z 2026-06-01T10:25:00Z",
      removed: "2026-05-31T09:40:00Z 2026-05-31T09:41:00Z",
    });
    expect(r.worth).toBe(false);
    expect(r.reason).toBe("timestamps_only");
  });

  it("skips a long hash-only diff", () => {
    const r = evaluateSignificance({
      // 64-char hex — long enough to reach the hash rule.
      added: "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2",
      removed: "",
    });
    expect(r.worth).toBe(false);
    expect(r.reason).toBe("looks_like_hash");
  });

  it("skips a long random token / nonce diff", () => {
    const r = evaluateSignificance({
      // 64-char mixed-case alphanumeric token — reaches the token rule.
      added: "A1B2C3D4E5F6G7H8I9J0K1L2M3N4O5P6Q7R8S9T0U1V2W3X4Y5Z6a7b8c9d0e1f2",
      removed: "",
    });
    expect(r.worth).toBe(false);
    expect(r.reason).toBe("looks_like_token");
  });

  it("keeps a real textual change", () => {
    const r = evaluateSignificance({
      added: "We just launched a new Enterprise plan with SSO and priority support.",
      removed: "Our Pro plan now includes advanced analytics.",
    });
    expect(r.worth).toBe(true);
    expect(r.reason).toBeUndefined();
  });

  it("keeps a pricing change with numbers and real words", () => {
    const r = evaluateSignificance({
      added: "Pro plan is now $49 per month, up from $39 per month.",
      removed: "Pro plan is $39 per month, billed annually at $390.",
    });
    expect(r.worth).toBe(true);
  });
});
