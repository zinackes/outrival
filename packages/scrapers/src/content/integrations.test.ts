import { test, expect, describe } from "bun:test";
import {
  integrationFromUrl,
  integrationsFromUrls,
  looksLikeIntegrationsIndex,
  parseIntegrationTiles,
  planIntegrationsRun,
} from "./integrations";

const name = (url: string) => integrationFromUrl(url)?.displayName ?? null;

describe("integrationFromUrl — a catalog URL names an integration", () => {
  test.each([
    ["https://acme.test/integrations/slack", "Slack"],
    ["https://acme.test/integration/slack", "Slack"],
    ["https://acme.test/apps/notion", "Notion"],
    ["https://acme.test/marketplace/zapier", "Zapier"],
    ["https://acme.test/integrations/microsoft-teams", "Microsoft Teams"],
    ["https://acme.test/integrations/slack/", "Slack"],
    // A catalog that suffixes its own slugs must not file the vendor twice.
    ["https://acme.test/integrations/slack-integration", "Slack"],
    ["https://acme.test/partners/datadog", "Datadog"],
  ])("%s → %s", (url, expected) => {
    expect(name(url)).toBe(expected);
  });

  test("the catalog itself is not an integration", () => {
    expect(integrationFromUrl("https://acme.test/integrations")).toBeNull();
    expect(integrationFromUrl("https://acme.test/integrations/")).toBeNull();
    expect(integrationFromUrl("https://acme.test/marketplace")).toBeNull();
  });

  test("a partner PROGRAMME page is not a catalog entry", () => {
    // "/partners without a child slug is ignored" — a programme page is a funnel,
    // and reading it as a catalog would file its own vocabulary as vendors.
    expect(integrationFromUrl("https://acme.test/partners")).toBeNull();
    expect(integrationFromUrl("https://acme.test/partners/become-a-partner")).toBeNull();
    expect(integrationFromUrl("https://acme.test/partners/apply")).toBeNull();
    expect(integrationFromUrl("https://acme.test/integrations/categories")).toBeNull();
    expect(integrationFromUrl("https://acme.test/integrations/page")).toBeNull();
  });

  test("a page that merely mentions an integration is not one", () => {
    expect(integrationFromUrl("https://acme.test/blog/why-we-love-slack")).toBeNull();
    expect(integrationFromUrl("https://acme.test/docs/api/slack")).toBeNull();
    expect(integrationFromUrl("https://acme.test/pricing")).toBeNull();
  });

  test("a slug that is a sentence, a number or a file is dropped", () => {
    expect(
      integrationFromUrl("https://acme.test/integrations/how-to-connect-your-crm-in-five-minutes"),
    ).toBeNull();
    expect(integrationFromUrl("https://acme.test/integrations/2")).toBeNull();
    expect(integrationFromUrl("https://acme.test/integrations/index.html")).toBeNull();
  });

  test("the German and Spanish catalog paths read the same way", () => {
    expect(name("https://acme.test/integrationen/slack")).toBe("Slack");
    expect(name("https://acme.test/integraciones/hubspot")).toBe("Hubspot");
    expect(name("https://acme.test/partenaires/qonto")).toBe("Qonto");
  });

  test("integrationsFromUrls dedups on the registry key", () => {
    const hits = integrationsFromUrls([
      "https://acme.test/integrations/slack",
      "https://acme.test/apps/slack",
      "https://acme.test/blog/post",
    ]);
    expect(hits.map((h) => h.nameNormalized)).toEqual(["slack"]);
  });
});

describe("parseIntegrationTiles — conservative by design", () => {
  const page = (body: string) => `<html><head><title>Integrations</title></head><body>${body}</body></html>`;

  test("reads links that go into the catalog", () => {
    const html = page(`
      <main>
        <a href="/integrations/slack">Slack</a>
        <a href="/integrations/notion">Notion</a>
      </main>`);
    const hits = parseIntegrationTiles(html, "https://acme.test/integrations");
    expect(hits.map((h) => h.displayName).sort()).toEqual(["Notion", "Slack"]);
  });

  test("reads tile logos by alt text", () => {
    const html = page(`<main><img alt="Datadog" src="/l/dd.svg" /></main>`);
    expect(parseIntegrationTiles(html, "https://acme.test/integrations")[0]?.displayName).toBe(
      "Datadog",
    );
  });

  test("section headings are NOT read — they look exactly like tile titles", () => {
    const html = page(`
      <main>
        <h2>Popular</h2><h2>CRM</h2><h3>All integrations</h3>
        <a href="/integrations/slack">Slack</a>
      </main>`);
    const hits = parseIntegrationTiles(html, "https://acme.test/integrations");
    expect(hits.map((h) => h.displayName)).toEqual(["Slack"]);
  });

  test("site chrome is excluded, so the competitor's own logo is not an integration", () => {
    const html = page(`
      <header><img alt="Acme" src="/logo.svg" /><a href="/integrations/slack">Integrations</a></header>
      <footer><img alt="Acme" src="/logo.svg" /></footer>
      <main><img alt="Stripe" src="/l/stripe.svg" /></main>`);
    const hits = parseIntegrationTiles(html, "https://acme.test/integrations");
    expect(hits.map((h) => h.displayName)).toEqual(["Stripe"]);
  });

  test("an off-host link is somebody else's page", () => {
    const html = page(`<main><a href="https://other.test/integrations/slack">Slack</a></main>`);
    expect(parseIntegrationTiles(html, "https://acme.test/integrations")).toEqual([]);
  });

  test("a card whose link text is a sentence falls back to the slug", () => {
    const html = page(`
      <main><a href="/integrations/slack">Send every alert straight into your team channel</a></main>`);
    expect(parseIntegrationTiles(html, "https://acme.test/integrations")[0]?.displayName).toBe(
      "Slack",
    );
  });

  test("a page with nothing catalog-shaped yields nothing", () => {
    const html = page(`<main><p>We integrate with everything you already use.</p></main>`);
    expect(parseIntegrationTiles(html, "https://acme.test/integrations")).toEqual([]);
  });
});

describe("looksLikeIntegrationsIndex — a 200 is not a catalog", () => {
  test("a page that names itself and has tiles is one", () => {
    const html = `<html><head><title>Integrations | Acme</title></head><body><main>
      <a href="/integrations/slack">Slack</a><a href="/integrations/notion">Notion</a>
    </main></body></html>`;
    expect(looksLikeIntegrationsIndex(html, "https://acme.test/integrations")).toBe(true);
  });

  test("a homepage served for an unknown path is not, even though it is full of logos", () => {
    const html = `<html><head><title>Acme — the platform for teams</title></head><body><main>
      <h1>One platform</h1><img alt="Slack" src="/a.svg" /><img alt="Notion" src="/b.svg" />
    </main></body></html>`;
    expect(looksLikeIntegrationsIndex(html, "https://acme.test/integrations")).toBe(false);
  });

  test("a page that names itself but lists nothing is not one either", () => {
    const html = `<html><head><title>Integrations</title></head><body><main>
      <h1>Integrations</h1><p>Coming soon.</p></main></body></html>`;
    expect(looksLikeIntegrationsIndex(html, "https://acme.test/integrations")).toBe(false);
  });
});

describe("planIntegrationsRun", () => {
  test("the first read of a catalog is a baseline", () => {
    expect(planIntegrationsRun({ heldRows: 0 })).toEqual({ mode: "baseline" });
  });

  test("once anything is held, a run can signal", () => {
    expect(planIntegrationsRun({ heldRows: 1 })).toEqual({ mode: "read" });
  });
});
