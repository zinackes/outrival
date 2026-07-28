import { test, expect } from "bun:test";
import { detectMobileApps, lookupAppStoreId, playStoreUrl } from "./mobile-apps";

const footer = (links: string) => `<html><body><footer>${links}</footer></body></html>`;

test("reads both store badges out of a footer", () => {
  const html = footer(
    `<a href="https://apps.apple.com/us/app/slack/id618783545">iOS</a>
     <a href="https://play.google.com/store/apps/details?id=com.Slack">Android</a>`,
  );
  const apps = detectMobileApps(html, "https://slack.com");
  expect(apps.ios).toEqual({
    appId: "618783545",
    country: "us",
    url: "https://apps.apple.com/us/app/slack/id618783545",
  });
  expect(apps.android).toEqual({
    packageName: "com.Slack",
    url: playStoreUrl("com.Slack"),
  });
});

test("handles protocol-relative hrefs and escaped query separators", () => {
  const html = footer(
    `<a href="//apps.apple.com/fr/app/linear/id1531594277">iOS</a>
     <a href="//play.google.com/store/apps/details?id=app.linear&amp;hl=fr">Android</a>`,
  );
  const apps = detectMobileApps(html, "https://linear.app");
  expect(apps.ios?.appId).toBe("1531594277");
  expect(apps.ios?.country).toBe("fr");
  expect(apps.android?.packageName).toBe("app.linear");
});

test("a smart app banner alone is enough for the iOS half", () => {
  const html = `<html><head><meta name="apple-itunes-app" content="app-id=284882215, app-argument=x"></head><body></body></html>`;
  const apps = detectMobileApps(html, "https://facebook.com");
  expect(apps.ios?.appId).toBe("284882215");
  expect(apps.ios?.url).toBe("https://apps.apple.com/us/app/id284882215");
  expect(apps.android).toBeNull();
});

test("a link for the banner's app wins over the banner (it carries the storefront)", () => {
  const html = `<meta name="apple-itunes-app" content="app-id=618783545">
    <a href="https://apps.apple.com/gb/app/slack/id618783545">iOS</a>`;
  const apps = detectMobileApps(html, "https://slack.com");
  expect(apps.ios?.country).toBe("gb");
});

test("a page with no app yields nothing", () => {
  const apps = detectMobileApps(footer(`<a href="https://twitter.com/acme">Twitter</a>`), "https://acme.com");
  expect(apps).toEqual({ ios: null, android: null });
});

test("among several linked apps, the one naming the brand wins", () => {
  const html = footer(
    `<a href="https://apps.apple.com/us/app/partner-crm/id111111111">Partner</a>
     <a href="https://apps.apple.com/us/app/acme/id222222222">Ours</a>
     <a href="https://play.google.com/store/apps/details?id=com.partner.crm">Partner</a>
     <a href="https://play.google.com/store/apps/details?id=com.acme.mobile">Ours</a>`,
  );
  const apps = detectMobileApps(html, "https://acme.com");
  expect(apps.ios?.appId).toBe("222222222");
  expect(apps.android?.packageName).toBe("com.acme.mobile");
});

test("an identity-provider package is plumbing, not a consumer app", () => {
  const html = footer(`<a href="https://play.google.com/store/apps/details?id=com.okta.android.auth">SSO</a>`);
  expect(detectMobileApps(html, "https://acme.com").android).toBeNull();
});

test("a developer page id is not an app id", () => {
  const html = footer(`<a href="https://apps.apple.com/us/developer/acme/id123456789">Our apps</a>`);
  expect(detectMobileApps(html, "https://acme.com").ios).toBeNull();
});

test("lookup resolves a bundle id to its numeric app id", async () => {
  const app = await lookupAppStoreId("com.acme.app", "us", {
    fetchJson: async () => ({
      resultCount: 1,
      results: [{ trackId: 987654321, trackViewUrl: "https://apps.apple.com/us/app/acme/id987654321" }],
    }),
  });
  expect(app).toEqual({
    appId: "987654321",
    country: "us",
    url: "https://apps.apple.com/us/app/acme/id987654321",
  });
});

test("lookup failures and empty results are silent", async () => {
  expect(await lookupAppStoreId("com.acme.app", "us", { fetchJson: async () => ({ results: [] }) })).toBeNull();
  expect(
    await lookupAppStoreId("com.acme.app", "us", {
      fetchJson: async () => {
        throw new Error("rate limited");
      },
    }),
  ).toBeNull();
});
