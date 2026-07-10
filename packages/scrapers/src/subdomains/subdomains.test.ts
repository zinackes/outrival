import { test, expect, describe } from "bun:test";
import { computeTextDiff } from "@outrival/shared";
import { selectCandidates, classifyKind, isInfra } from "./filter";
import { fetchCrtSh, type CrtShEntry } from "./crtsh";
import { buildSnapshot, collectLiveSubdomains } from "./subdomains.scraper";
import { extractContent } from "../lib/extract-content";

// A trimmed crt.sh payload mixing: a precert+leaf pair (same names, different
// id/serial), a wildcard, infra noise (www/mail/_dmarc), CDN/hashed/deep hosts,
// a product surface, a regional host, and a sibling-domain SAN that isn't ours.
const ENTRIES: CrtShEntry[] = [
  { common_name: "beta.acme.com", name_value: "beta.acme.com", not_before: "2026-07-01T00:00:00", serial_number: "aaa" },
  { common_name: "beta.acme.com", name_value: "beta.acme.com", not_before: "2026-07-01T00:00:00", serial_number: "bbb" }, // leaf of the same cert
  { common_name: "*.acme.com", name_value: "*.acme.com\nacme.com", not_before: "2026-06-01T00:00:00" },
  { name_value: "www.acme.com\nmail.acme.com\n_dmarc.acme.com", not_before: "2026-05-01T00:00:00" },
  { name_value: "s3-x.cf.staging.acme.com\ndeadbeefdeadbeef.acme.com\na.b.c.acme.com", not_before: "2026-05-01T00:00:00" },
  { name_value: "ai.acme.com\neu.acme.com", not_before: "2026-06-15T00:00:00" },
  { name_value: "app.acme.com\nfoo.evil.com", not_before: "2026-04-01T00:00:00" },
];

describe("selectCandidates — dedup, wildcard + infra filter, own-domain lock", () => {
  const cands = selectCandidates(ENTRIES, "acme.com");
  const hosts = cands.map((c) => c.host).sort();

  test("(a) collapses the precert/leaf pair into one host", () => {
    expect(hosts.filter((h) => h === "beta.acme.com")).toHaveLength(1);
  });

  test("(b) keeps only live-worthy product/regional/generic hosts", () => {
    expect(hosts).toEqual(["ai.acme.com", "app.acme.com", "beta.acme.com", "eu.acme.com"]);
  });

  test("(b) drops wildcard, apex, infra, hashed, deep-nested and foreign hosts", () => {
    for (const bad of [
      "acme.com", "www.acme.com", "mail.acme.com", "_dmarc.acme.com",
      "s3-x.cf.staging.acme.com", "deadbeefdeadbeef.acme.com", "a.b.c.acme.com",
      "foo.evil.com",
    ]) {
      expect(hosts).not.toContain(bad);
    }
  });
});

describe("classifyKind — deterministic tiering drives the annotation", () => {
  test("beta / new- prefixes → beta", () => {
    expect(classifyKind("beta.acme.com", "acme.com")).toBe("beta");
    expect(classifyKind("new-portal.acme.com", "acme.com")).toBe("beta");
    expect(classifyKind("preview.acme.com", "acme.com")).toBe("beta");
  });
  test("region tokens → regional; generic surfaces → other", () => {
    expect(classifyKind("eu.acme.com", "acme.com")).toBe("regional");
    expect(classifyKind("app.acme.com", "acme.com")).toBe("other");
  });
  test("unknown token → product (novel surface)", () => {
    expect(classifyKind("ai.acme.com", "acme.com")).toBe("product");
    expect(classifyKind("studio.acme.com", "acme.com")).toBe("product");
  });
  test("isInfra guards mail/staging/hashed but not a product surface", () => {
    expect(isInfra("mail.acme.com", "acme.com")).toBe(true);
    expect(isInfra("staging.acme.com", "acme.com")).toBe(true);
    expect(isInfra("ai.acme.com", "acme.com")).toBe(false);
  });
});

describe("buildSnapshot — deterministic sorted list", () => {
  const cands = selectCandidates(ENTRIES, "acme.com");

  test("is order-independent (stable content hash)", () => {
    const a = buildSnapshot("acme.com", cands);
    const b = buildSnapshot("acme.com", [...cands].reverse());
    expect(a.html).toBe(b.html);
    expect(a.text).toBe(b.text);
  });

  test("(c) the generic diff surfaces a genuinely new live subdomain", () => {
    const before = buildSnapshot("acme.com", cands);
    const withNew = selectCandidates(
      [...ENTRIES, { name_value: "chat.acme.com", not_before: "2026-07-05T00:00:00" }],
      "acme.com",
    );
    const after = buildSnapshot("acme.com", withNew);

    // The real production diff path: extractContent → computeTextDiff.
    const diff = computeTextDiff(
      extractContent(before.html, "subdomains"),
      extractContent(after.html, "subdomains"),
    );
    expect(diff.hasChanges).toBe(true);
    const added = diff.added.join("\n");
    expect(added).toContain("chat.acme.com"); // the new subdomain shows up
    expect(added).not.toContain("ai.acme.com"); // an unchanged host does not
  });
});

describe("collectLiveSubdomains — liveness gate + fail-loud", () => {
  const okFetch: typeof fetch = async () => new Response(JSON.stringify(ENTRIES));

  test("keeps only hosts the probe reports live", async () => {
    const live = await collectLiveSubdomains("acme.com", {
      fetchFn: okFetch,
      probe: async (h) => h === "ai.acme.com" || h === "beta.acme.com",
    });
    expect(live.map((c) => c.host).sort()).toEqual(["ai.acme.com", "beta.acme.com"]);
  });

  test("(d) throws rather than emit an empty snapshot when nothing is live", async () => {
    await expect(
      collectLiveSubdomains("acme.com", { fetchFn: okFetch, probe: async () => false }),
    ).rejects.toThrow("no_live_subdomains");
  });
});

describe("fetchCrtSh — retry/backoff + payload guard", () => {
  test("retries a 502 then succeeds", async () => {
    let calls = 0;
    const flaky: typeof fetch = async () => {
      calls++;
      return calls < 2
        ? new Response("upstream", { status: 502 })
        : new Response(JSON.stringify([{ name_value: "x.acme.com" }]));
    };
    const entries = await fetchCrtSh("acme.com", { fetchFn: flaky, retries: 3 });
    expect(entries).toHaveLength(1);
    expect(calls).toBe(2);
  });

  test("throws on a non-array payload (no phantom empty result)", async () => {
    await expect(
      fetchCrtSh("acme.com", { fetchFn: async () => new Response("null"), retries: 0 }),
    ).rejects.toThrow();
  });
});
