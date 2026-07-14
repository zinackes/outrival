import { test, expect, describe } from "bun:test";
import {
  parseAASA,
  parseAssetlinks,
  parseLlms,
  isIdentityProvider,
  buildFingerprint,
  buildWellKnownDoc,
  parseWellKnownDoc,
  wellKnownDelta,
} from "./wellknown";
import { collectWellKnown } from "./wellknown.scraper";
import { extractContent, isContentCollapsed } from "../lib/extract-content";

describe("parsers", () => {
  test("parseAASA reads appIDs (current) and appID (legacy), applinks only", () => {
    const current = {
      applinks: { details: [{ appIDs: ["9JA89QQLNQ.com.acme.app"], components: [] }] },
      // webcredentials (passkey) is deliberately ignored — no app launch.
      webcredentials: { apps: ["9JA89QQLNQ.com.acme.passkeyonly"] },
    };
    expect(parseAASA(current)).toEqual(["9JA89QQLNQ.com.acme.app"]);
    const legacy = { applinks: { details: [{ appID: "TEAMID.com.acme.legacy", paths: ["*"] }] } };
    expect(parseAASA(legacy)).toEqual(["TEAMID.com.acme.legacy"]);
    expect(parseAASA({ webcredentials: { apps: ["x"] } })).toEqual([]); // passkey-only → nothing
    expect(parseAASA(null)).toEqual([]);
  });

  test("parseAssetlinks reads android_app package_name only", () => {
    const json = [
      { relation: ["delegate_permission/common.handle_all_urls"], target: { namespace: "android_app", package_name: "com.acme.app", sha256_cert_fingerprints: ["AA:BB"] } },
      { relation: [], target: { namespace: "web", site: "https://acme.com" } },
    ];
    expect(parseAssetlinks(json)).toEqual(["com.acme.app"]);
    expect(parseAssetlinks({})).toEqual([]);
  });

  test("parseLlms extracts markdown + bare links, capped", () => {
    const txt = `# Acme\n> docs\n- [Guide](https://acme.com/guide)\n- [API](https://acme.com/api)\nSee https://acme.com/pricing`;
    expect(parseLlms(txt)).toEqual([
      "https://acme.com/guide",
      "https://acme.com/api",
      "https://acme.com/pricing",
    ]);
  });

  test("isIdentityProvider flags known IdP bundles/packages", () => {
    expect(isIdentityProvider("com.okta.android.auth")).toBe(true);
    expect(isIdentityProvider("com.auth0.app")).toBe(true);
    expect(isIdentityProvider("com.duosecurity.duomobile")).toBe(true);
    expect(isIdentityProvider("com.acme.app")).toBe(false);
  });
});

describe("(e) a new consumer package → an app-launch tell", () => {
  test("buildFingerprint keeps the consumer app; delta surfaces it as new", () => {
    const prev = buildFingerprint({ assetlinks: [] });
    const current = buildFingerprint({
      assetlinks: [
        { target: { namespace: "android_app", package_name: "com.acme.mobile", sha256_cert_fingerprints: ["AA"] } },
      ],
    });
    expect(current.androidPackages).toEqual(["com.acme.mobile"]);
    const delta = wellKnownDelta(prev, current);
    expect(delta.newApps).toEqual(["com.acme.mobile"]); // exactly one → the branch forces product/high
  });
});

describe("(f) an identity-provider-only file → NO signal", () => {
  test("an assetlinks with only an Okta package yields an empty fingerprint", () => {
    const fp = buildFingerprint({
      assetlinks: [
        { target: { namespace: "android_app", package_name: "com.okta.android.auth", sha256_cert_fingerprints: ["AA"] } },
      ],
    });
    expect(fp.androidPackages).toEqual([]); // Okta filtered → no app tell
    expect(wellKnownDelta(buildFingerprint({ assetlinks: [] }), fp).newApps).toEqual([]);
  });

  test("an AASA whose only appID is an IdP bundle also yields nothing", () => {
    const fp = buildFingerprint({
      aasa: { applinks: { details: [{ appIDs: ["TEAM.com.auth0.guardian"] }] } },
    });
    expect(fp.appIDs).toEqual([]);
  });
});

describe("(g) total absence → clean degradation, no failure", () => {
  test("collectWellKnown never throws when every file is missing", async () => {
    const { domain, raw } = await collectWellKnown("https://plainsite.com", {
      fetchText: async () => null,
    });
    expect(domain).toBe("plainsite.com");
    const fp = buildFingerprint(raw);
    expect(fp).toEqual({ appIDs: [], androidPackages: [], llmsPresent: false, llmsLinks: [] });
  });

  test("an empty fingerprint snapshot never grades as collapsed", () => {
    for (const d of ["x.io", "plainsite.com"]) {
      const { html } = buildWellKnownDoc(d, { appIDs: [], androidPackages: [], llmsPresent: false, llmsLinks: [] });
      expect(isContentCollapsed(extractContent(html, "wellknown"))).toBe(false);
    }
  });
});

describe("snapshot round-trip + llms delta", () => {
  test("parseWellKnownDoc recovers the fingerprint; a first-time llms.txt surfaces", () => {
    const prev = buildFingerprint({ llms: null });
    const current = buildFingerprint({ llms: "# Acme\n- [Docs](https://acme.com/docs)" });
    const doc = buildWellKnownDoc("acme.com", current);
    expect(parseWellKnownDoc(doc.html)).toEqual(current);
    const delta = wellKnownDelta(prev, current);
    expect(delta.llmsAppeared).toBe(true);
    expect(delta.newApps).toEqual([]);
  });

  test("first scrape (no prior) never signals", () => {
    const current = buildFingerprint({
      assetlinks: [{ target: { namespace: "android_app", package_name: "com.acme.app", sha256_cert_fingerprints: ["AA"] } }],
    });
    expect(wellKnownDelta(null, current)).toEqual({ newApps: [], llmsAppeared: false });
  });
});
