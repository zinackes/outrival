import { test, expect, describe, afterEach } from "bun:test";
import { computeTextDiff } from "@outrival/shared";
import { extractContent } from "../lib/extract-content";
import {
  buildOpenApiDoc,
  buildOpenApiFacts,
  findSpecLinks,
  operationLine,
  parseSpec,
  schemaLine,
  specCandidates,
} from "./openapi";
import {
  buildDocsPagesDoc,
  filterDocsUrls,
  hashDocsPages,
  selectPagesToHash,
} from "./pages";
import { discoverDocsRoot, docsLinkIn, docsRootFromLanding, looksLikeDocsUrl } from "./discover";
import { scrape, type DocsDeps } from "./docs.scraper";

/**
 * The `docs` source's contract, in three parts:
 *   (a) an OpenAPI spec change surfaces STRUCTURALLY through the production diff path
 *   (b) an HTML-only competitor surfaces a new docs page through the sitemap mode
 *   (c) every "nothing to read" case degrades cleanly and never fakes a snapshot
 *
 * (a) and (b) deliberately run `computeTextDiff(extractContent(before), extractContent(
 * after))` — the exact pair scrape-monitor calls on the generic path — rather than a
 * parallel differ, so the assertions are about what production will actually see.
 */

// --- fixtures ---------------------------------------------------------------

const SPEC_V1 = {
  openapi: "3.0.3",
  info: { title: "Acme API", version: "2024-01-01" },
  paths: {
    "/v1/charges": {
      get: { summary: "List charges", parameters: [{ name: "limit" }, { name: "expand" }] },
    },
    "/v1/payment_intents": {
      post: { summary: "Create a PaymentIntent", parameters: [{ name: "amount" }, { name: "currency" }] },
    },
  },
  components: {
    schemas: {
      Charge: {
        properties: { amount: {}, currency: {}, legacy_source: {}, status: {} },
      },
    },
  },
};

// v2 carries three independent structural moves:
//   1. a brand-new endpoint  (POST /v1/payment_intents/{id}/capture)
//   2. an endpoint turning deprecated (GET /v1/charges)
//   3. a schema FIELD turning deprecated (Charge.legacy_source)
const SPEC_V2 = {
  ...SPEC_V1,
  paths: {
    "/v1/charges": {
      get: {
        summary: "List charges",
        deprecated: true,
        parameters: [{ name: "limit" }, { name: "expand" }],
      },
    },
    "/v1/payment_intents": {
      post: { summary: "Create a PaymentIntent", parameters: [{ name: "amount" }, { name: "currency" }] },
    },
    "/v1/payment_intents/{id}/capture": {
      post: { summary: "Capture a PaymentIntent", parameters: [{ name: "id" }, { name: "amount_to_capture" }] },
    },
  },
  components: {
    schemas: {
      Charge: {
        properties: { amount: {}, currency: {}, legacy_source: { deprecated: true }, status: {} },
      },
    },
  },
};

function docFor(spec: Record<string, unknown>): { html: string; text: string } {
  return buildOpenApiDoc(buildOpenApiFacts(spec), {
    domain: "acme.com",
    specUrl: "https://docs.acme.com/openapi.json",
  });
}

/** The production diff pair: extractContent on both sides, then computeTextDiff. */
function productionDiff(beforeHtml: string, afterHtml: string) {
  return computeTextDiff(extractContent(beforeHtml, "docs"), extractContent(afterHtml, "docs"));
}

function sitemapXml(urls: string[]): string {
  return `<?xml version="1.0"?><urlset>${urls
    .map((u) => `<url><loc>${u}</loc></url>`)
    .join("")}</urlset>`;
}

// --- (a) OpenAPI structural diff -------------------------------------------

describe("(a) OpenAPI spec → structural diff, zero AI", () => {
  test("a new endpoint AND a newly deprecated field surface as diff lines", () => {
    const before = docFor(SPEC_V1);
    const after = docFor(SPEC_V2);
    const diff = productionDiff(before.html, after.html);

    expect(diff.hasChanges).toBe(true);

    const added = diff.added.join("\n");
    const removed = diff.removed.join("\n");

    // 1. the brand-new endpoint
    expect(added).toContain("POST /v1/payment_intents/{id}/capture — API endpoint");
    expect(added).toContain("params: amount_to_capture, id");

    // 2. the endpoint that turned deprecated: the marked line arrives, the unmarked
    //    one leaves — a sunset reads as a replacement, not as a silent edit.
    expect(added).toContain("GET /v1/charges — API endpoint [DEPRECATED");
    expect(removed).toContain("GET /v1/charges — API endpoint (params:");
    expect(removed).not.toContain("GET /v1/charges — API endpoint [DEPRECATED");

    // 3. the schema field that turned deprecated
    expect(added).toContain("schema Charge — data model fields: amount, currency, legacy_source [DEPRECATED");
    expect(removed).toContain("schema Charge — data model fields: amount, currency, legacy_source, status");
  });

  test("the untouched endpoint produces no diff line at all", () => {
    const diff = productionDiff(docFor(SPEC_V1).html, docFor(SPEC_V2).html);
    const touched = [...diff.added, ...diff.removed].join("\n");
    expect(touched).not.toContain("POST /v1/payment_intents — API endpoint");
  });

  test("the same spec twice is byte-identical → no change (sorting is the guarantee)", () => {
    // Property re-ordered on the wire: canonical sorting must absorb it entirely,
    // otherwise every scrape of a hash-ordered spec would fake a full rewrite.
    const shuffled = {
      ...SPEC_V1,
      paths: {
        "/v1/payment_intents": (SPEC_V1.paths as Record<string, unknown>)["/v1/payment_intents"],
        "/v1/charges": (SPEC_V1.paths as Record<string, unknown>)["/v1/charges"],
      },
    };
    expect(docFor(shuffled).text).toBe(docFor(SPEC_V1).text);
    expect(productionDiff(docFor(SPEC_V1).html, docFor(shuffled).html).hasChanges).toBe(false);
  });

  test("the intro + header ground the diff and count deprecation/beta", () => {
    const text = docFor(SPEC_V2).text.split("\n");
    expect(text[0]).toContain("Developer API documentation for acme.com");
    expect(text[1]).toBe(
      'OpenAPI "Acme API" v2024-01-01 — 3 endpoints (1 deprecated, 0 beta), 1 schemas',
    );
  });

  test("beta vocabulary in the path or the summary marks the operation", () => {
    const facts = buildOpenApiFacts({
      openapi: "3.0.0",
      info: { title: "A", version: "1" },
      paths: {
        "/v2beta/agents": { get: {} },
        "/v1/stable": { get: { summary: "Public preview of the new engine" } },
        "/v1/plain": { get: { summary: "Nothing special" } },
      },
    });
    expect(facts.operations.find((o) => o.path === "/v2beta/agents")?.beta).toBe(true);
    expect(facts.operations.find((o) => o.path === "/v1/stable")?.beta).toBe(true);
    expect(facts.operations.find((o) => o.path === "/v1/plain")?.beta).toBe(false);
    expect(operationLine(facts.operations.find((o) => o.path === "/v2beta/agents")!)).toContain(
      "[BETA",
    );
  });
});

describe("parseSpec", () => {
  test("YAML and JSON of the same spec produce identical facts", () => {
    const yaml = `
openapi: 3.0.3
info:
  title: Acme API
  version: '2024-01-01'
paths:
  /v1/charges:
    get:
      summary: List charges
      parameters:
        - name: limit
        - name: expand
  /v1/payment_intents:
    post:
      summary: Create a PaymentIntent
      parameters:
        - name: amount
        - name: currency
components:
  schemas:
    Charge:
      properties:
        amount: {}
        currency: {}
        legacy_source: {}
        status: {}
`;
    const fromYaml = parseSpec(yaml, "https://docs.acme.com/openapi.yaml");
    expect(fromYaml).not.toBeNull();
    expect(buildOpenApiFacts(fromYaml!)).toEqual(buildOpenApiFacts(SPEC_V1));
  });

  test("Swagger 2 definitions are read as schemas", () => {
    const spec = parseSpec(
      JSON.stringify({
        swagger: "2.0",
        info: { title: "Legacy", version: "1" },
        paths: { "/ping": { get: {} } },
        definitions: { Pong: { properties: { ok: {} } } },
      }),
      "https://acme.com/swagger.json",
    );
    expect(spec).not.toBeNull();
    expect(buildOpenApiFacts(spec!).schemas.map((s) => s.name)).toEqual(["Pong"]);
  });

  test("a non-spec body at a conventional path is rejected, never half-read", () => {
    // The mode-1 trap: a package.json / docs config living at /openapi.json would pin
    // the source into a hollow structured snapshot forever.
    expect(parseSpec(JSON.stringify({ name: "acme", version: "1.0.0" }), "/openapi.json")).toBeNull();
    expect(parseSpec(JSON.stringify({ openapi: "3.0.0" }), "/openapi.json")).toBeNull(); // no paths
    expect(parseSpec(JSON.stringify({ paths: {} }), "/openapi.json")).toBeNull(); // no version
    expect(parseSpec("<html>not a spec</html>", "/openapi.json")).toBeNull();
    expect(parseSpec("", "/openapi.json")).toBeNull();
  });
});

describe("spec location discovery", () => {
  test("candidates cover the docs root and the origin, deduped", () => {
    const list = specCandidates("https://acme.com/docs", "https://acme.com");
    expect(list).toContain("https://acme.com/docs/openapi.json");
    expect(list).toContain("https://acme.com/docs/openapi.yaml");
    expect(list).toContain("https://acme.com/.well-known/openapi.json");
    expect(new Set(list).size).toBe(list.length);
  });

  test("findSpecLinks reads plain links and renderer attributes", () => {
    const html = `<html><body>
      <a href="/spec/v2/openapi.yaml">Download</a>
      <redoc spec-url="https://cdn.acme.com/openapi-public.json"></redoc>
      <script src="/assets/app.js"></script>
      <a href="/pricing">Pricing</a>
    </body></html>`;
    const links = findSpecLinks(html, "https://docs.acme.com/");
    expect(links).toContain("https://docs.acme.com/spec/v2/openapi.yaml");
    expect(links).toContain("https://cdn.acme.com/openapi-public.json");
    expect(links.some((l) => l.includes("app.js"))).toBe(false);
  });
});

// --- (b) HTML-only mode: sitemap diff + page fingerprints ------------------

describe("(b) HTML docs → sitemap page diff", () => {
  const PAGES_V1 = [
    "https://docs.acme.com/getting-started",
    "https://docs.acme.com/guides/auth",
  ];
  const PAGES_V2 = [...PAGES_V1, "https://docs.acme.com/api/webhooks"];

  test("a new docs page surfaces as exactly one added line", () => {
    const before = buildDocsPagesDoc(PAGES_V1, [], { domain: "acme.com", docsRoot: "https://docs.acme.com/" });
    const after = buildDocsPagesDoc([...PAGES_V2].sort(), [], { domain: "acme.com", docsRoot: "https://docs.acme.com/" });
    const diff = productionDiff(before.html, after.html);

    expect(diff.hasChanges).toBe(true);
    // computeTextDiff groups ADJACENT changed lines into one chunk, so assertions go
    // through the flattened lines rather than the chunk array.
    const addedLines = diff.added.flatMap((c) => c.split("\n"));
    const removedLines = diff.removed.flatMap((c) => c.split("\n"));

    expect(addedLines).toContain("https://docs.acme.com/api/webhooks — documentation page");
    // Exactly one page line moves in, none moves out. The count header changes too
    // (2 → 3 pages), which is the intended, readable signal.
    expect(addedLines.filter((l) => l.startsWith("https://"))).toHaveLength(1);
    expect(removedLines.filter((l) => l.startsWith("https://"))).toHaveLength(0);
    expect(addedLines.some((l) => l.includes("— 3 pages"))).toBe(true);
  });

  test("a rewritten page flips exactly its fingerprint line", async () => {
    const bodies: Record<string, string> = {
      "https://docs.acme.com/getting-started": "<html><body><p>Install the SDK. Rate limit 100 rpm.</p></body></html>",
      "https://docs.acme.com/guides/auth": "<html><body><p>Use a bearer token in the Authorization header.</p></body></html>",
    };
    const fetchHtml = async (u: string) => bodies[u] ?? null;

    const hashesBefore = await hashDocsPages(PAGES_V1, fetchHtml);
    const before = buildDocsPagesDoc(PAGES_V1, hashesBefore, { domain: "acme.com", docsRoot: "https://docs.acme.com/" });

    bodies["https://docs.acme.com/getting-started"] =
      "<html><body><p>Install the SDK. Rate limit 20 rpm.</p></body></html>";
    const hashesAfter = await hashDocsPages(PAGES_V1, fetchHtml);
    const after = buildDocsPagesDoc(PAGES_V1, hashesAfter, { domain: "acme.com", docsRoot: "https://docs.acme.com/" });

    const diff = productionDiff(before.html, after.html);
    const fingerprintLines = [...diff.added, ...diff.removed]
      .flatMap((c) => c.split("\n"))
      .filter((l) => l.startsWith("page "));
    expect(fingerprintLines).toHaveLength(2); // one removed + one added
    expect(fingerprintLines.every((l) => l.includes("/getting-started"))).toBe(true);
  });

  test("an unchanged page keeps its fingerprint across runs", async () => {
    const html = "<html><body><p>Stable documentation content that does not move.</p></body></html>";
    const a = await hashDocsPages(["https://docs.acme.com/x"], async () => html);
    const b = await hashDocsPages(["https://docs.acme.com/x"], async () => html);
    expect(a).toEqual(b);
  });

  test("a page that fails to fetch yields NO line (never a placeholder hash)", async () => {
    const hashes = await hashDocsPages(
      ["https://docs.acme.com/ok", "https://docs.acme.com/down"],
      async (u) => (u.endsWith("/ok") ? "<html><body><p>Real documented content here.</p></body></html>" : null),
    );
    expect(hashes.map((h) => h.url)).toEqual(["https://docs.acme.com/ok"]);
  });

  test("filterDocsUrls keeps only the docs surface", () => {
    const all = [
      "https://acme.com/docs/intro",
      "https://acme.com/docs",
      "https://acme.com/pricing",
      "https://acme.com/blog/post",
      "https://other.com/docs/x",
    ];
    expect(filterDocsUrls(all, "https://acme.com/docs")).toEqual([
      "https://acme.com/docs",
      "https://acme.com/docs/intro",
    ]);
    // A docs SUBDOMAIN root has no path prefix → its whole host qualifies.
    expect(
      filterDocsUrls(["https://docs.acme.com/a", "https://acme.com/b"], "https://docs.acme.com/"),
    ).toEqual(["https://docs.acme.com/a"]);
  });

  test("page selection is deterministic (shallowest, then lexicographic)", () => {
    const urls = [
      "https://d.acme.com/z/deep/deeper",
      "https://d.acme.com/b",
      "https://d.acme.com/a",
      "https://d.acme.com/m/mid",
    ];
    expect(selectPagesToHash(urls, 3)).toEqual([
      "https://d.acme.com/a",
      "https://d.acme.com/b",
      "https://d.acme.com/m/mid",
    ]);
    expect(selectPagesToHash(urls, 3)).toEqual(selectPagesToHash([...urls].reverse(), 3));
  });
});

// --- docs-root discovery ---------------------------------------------------

describe("docs root discovery", () => {
  test("a URL that is already a docs surface is honoured verbatim (user override)", async () => {
    // scrape-monitor passes `monitor.config.url ?? competitor.url`, so this is what
    // makes an explicit override authoritative instead of re-probing docs.<domain>.
    expect(looksLikeDocsUrl("https://docs.acme.com/")).toBe(true);
    expect(looksLikeDocsUrl("https://acme.com/api-reference/v2")).toBe(true);
    expect(looksLikeDocsUrl("https://acme.com/")).toBe(false);
    expect(looksLikeDocsUrl("https://acme.com/pricing")).toBe(false);

    const root = await discoverDocsRoot("https://acme.com/developers/reference", {
      reachable: async () => {
        throw new Error("must not probe when the URL is already a docs surface");
      },
    });
    expect(root).toEqual({ url: "https://acme.com/developers/reference", source: "given" });
  });

  test("subdomain wins over path, path over homepage link", async () => {
    const bySubdomain = await discoverDocsRoot("https://acme.com/", {
      reachable: async (u) => (u === "https://docs.acme.com/" ? u : null),
    });
    expect(bySubdomain).toEqual({ url: "https://docs.acme.com/", source: "subdomain" });

    const byPath = await discoverDocsRoot("https://acme.com/", {
      reachable: async (u) => (u === "https://acme.com/documentation" ? u : null),
    });
    expect(byPath).toEqual({ url: "https://acme.com/documentation", source: "path" });
  });

  test("the root is where the probe LANDED, cut back to the docs segment", async () => {
    // docs.trigger.dev serves trigger.dev/docs; docs.anthropic.com serves
    // platform.claude.com/docs. Keeping the probed host meant the docs sitemap — which
    // lists the landing host — filtered to zero and the source failed no_docs_index
    // while holding hundreds of pages.
    const redirected = await discoverDocsRoot("https://acme.com/", {
      reachable: async (u) =>
        u === "https://docs.acme.com/" ? "https://acme.io/docs/introduction" : null,
    });
    expect(redirected).toEqual({ url: "https://acme.io/docs", source: "subdomain" });

    // A localised docs site keeps its locale prefix.
    expect(docsRootFromLanding("https://acme.com/en/docs/quickstart")).toBe(
      "https://acme.com/en/docs",
    );
    // A docs subdomain qualifies whole — every path on it is documentation.
    expect(docsRootFromLanding("https://docs.acme.com/guides/auth")).toBe("https://docs.acme.com/");
  });

  test("a docs subdomain parked on the marketing site is not a docs surface", async () => {
    // docs.sendible.com answers 200 by redirecting to www.sendible.com. Treating that
    // as the docs root offered their site-wide marketing sitemap as documentation, and
    // failed `no_docs_index` — a failure nobody can fix. It is an absence.
    expect(docsRootFromLanding("https://www.acme.com/")).toBeNull();
    expect(docsRootFromLanding("https://help.acme.com/hc/en-us")).toBeNull();

    const parked = await discoverDocsRoot("https://acme.com/", {
      reachable: async (u) => (u === "https://docs.acme.com/" ? "https://www.acme.com/" : null),
      fetchHtml: async () => null,
    });
    expect(parked).toBeNull();
  });

  test("a nav link is the last resort, and only on the same registrable domain", async () => {
    const html = `<html><body><nav>
      <a href="https://acme.com/handbook">Documentation</a>
      <a href="https://readthedocs.io/acme">Docs</a>
    </nav></body></html>`;
    const root = await discoverDocsRoot("https://acme.com/", {
      reachable: async (u) => (u === "https://acme.com/handbook" ? u : null),
      fetchHtml: async () => html,
    });
    expect(root).toEqual({ url: "https://acme.com/handbook", source: "nav" });

    // Off-domain only → no docs root (we never monitor a third party's site).
    expect(
      docsLinkIn(
        `<nav><a href="https://readthedocs.io/acme">Docs</a></nav>`,
        "nav a",
        new URL("https://acme.com/"),
      ),
    ).toBeNull();
  });
});

// --- (c) clean degradation -------------------------------------------------

describe("(c) clean degradation", () => {
  const nothingReachable: DocsDeps = {
    reachable: async () => null,
    fetchHtml: async () => null,
    fetchBytes: async () => null,
    probeText: async () => ({ kind: "absent" }),
  };

  test("no docs surface at all → no_docs_surface (a neutral, not-available fact)", async () => {
    await expect(scrape("c1", "https://acme.com/", {}, nothingReachable)).rejects.toThrow(
      "docs: no_docs_surface",
    );
  });

  test("docs exist but expose neither a spec nor a sitemap → no_docs_index", async () => {
    await expect(
      scrape("c1", "https://docs.acme.com/", {}, {
        ...nothingReachable,
        fetchHtml: async () => "<html><body><h1>Docs</h1></body></html>",
      }),
    ).rejects.toThrow("docs: no_docs_index");
  });

  test("a transient spec probe failure NEVER degrades to sitemap mode", async () => {
    // The mode-flip guard: silently dropping from openapi to sitemap mode would diff as
    // "every line removed, every line added" — one enormous phantom signal.
    let sitemapWasWalked = false;
    await expect(
      scrape("c1", "https://docs.acme.com/", {}, {
        fetchHtml: async () => "<html><body><h1>Docs</h1></body></html>",
        probeText: async () => ({ kind: "transient" }),
        fetchBytes: async (u) => {
          sitemapWasWalked = true;
          return new TextEncoder().encode(sitemapXml(["https://docs.acme.com/a"]));
        },
      }),
    ).rejects.toThrow("docs: spec_probe_failed");
    expect(sitemapWasWalked).toBe(false);
  });

  test("a definitively-absent spec DOES fall through to sitemap mode", async () => {
    const outcome = await scrape("c1", "https://docs.acme.com/", {}, {
      fetchHtml: async (u) =>
        u === "https://docs.acme.com/"
          ? "<html><body><h1>Docs</h1></body></html>"
          : "<html><body><p>A documented page with enough content to hash.</p></body></html>",
      probeText: async () => ({ kind: "absent" }),
      fetchBytes: async (u) =>
        u.endsWith("/sitemap.xml")
          ? new TextEncoder().encode(
              sitemapXml(["https://docs.acme.com/a", "https://docs.acme.com/b"]),
            )
          : null,
    });
    expect(outcome.metadata.mode).toBe("sitemap");
    expect(outcome.metadata.pages).toBe(2);
    expect(outcome.text).toContain("https://docs.acme.com/a — documentation page");
  });

  test("every read in sitemap mode goes through the injected deps", async () => {
    // Guard for a leak that made this suite reach the real internet: robots.txt is the
    // first request of sitemap mode, and it used to call the module-level fetcher
    // instead of the injected one. Locally the fixture hostname failed DNS instantly
    // and everything looked green; on CI it hung to the timeout and failed three tests
    // that have nothing to do with robots.txt.
    const requested: string[] = [];
    await scrape("c1", "https://docs.acme.com/", {}, {
      reachable: async () => null,
      fetchHtml: async () => "<html><body><p>A documented page with enough content.</p></body></html>",
      probeText: async () => ({ kind: "absent" }),
      fetchBytes: async (u) => {
        requested.push(u);
        return u.endsWith("/sitemap.xml")
          ? new TextEncoder().encode(sitemapXml(["https://docs.acme.com/a"]))
          : null;
      },
    });
    expect(requested).toContain("https://docs.acme.com/robots.txt");
  });

  test("a spec found → mode openapi, and the snapshot is never hollow", async () => {
    const outcome = await scrape("c1", "https://docs.acme.com/", {}, {
      fetchHtml: async () => "<html><body><h1>Docs</h1></body></html>",
      probeText: async (u) =>
        u === "https://docs.acme.com/openapi.json"
          ? { kind: "body", text: JSON.stringify(SPEC_V1) }
          : { kind: "absent" },
      fetchBytes: async () => null,
    });
    expect(outcome.metadata.mode).toBe("openapi");
    expect(outcome.metadata.endpoints).toBe(2);
    expect(outcome.text).toContain("GET /v1/charges — API endpoint");
    expect(outcome.screenshotBuffer.length).toBe(0);
  });

  test("a competitor with no usable URL fails loudly", async () => {
    await expect(scrape("c1", "", {}, nothingReachable)).rejects.toThrow(
      "no registrable domain",
    );
  });
});

// --- page-hash kill switch -------------------------------------------------

describe("DOCS_PAGE_HASH_ENABLED kill-switch", () => {
  afterEach(() => {
    delete process.env.DOCS_PAGE_HASH_ENABLED;
  });

  test("false → the page list only, no fingerprint lines, no page fetches", async () => {
    process.env.DOCS_PAGE_HASH_ENABLED = "false";
    let pageFetches = 0;
    const outcome = await scrape("c1", "https://docs.acme.com/", {}, {
      fetchHtml: async (u) => {
        if (u !== "https://docs.acme.com/") pageFetches++;
        return "<html><body><h1>Docs</h1></body></html>";
      },
      probeText: async () => ({ kind: "absent" }),
      fetchBytes: async (u) =>
        u.endsWith("/sitemap.xml")
          ? new TextEncoder().encode(sitemapXml(["https://docs.acme.com/a"]))
          : null,
    });
    expect(outcome.metadata.hashedPages).toBe(0);
    expect(outcome.text).not.toContain("documented content fingerprint");
    expect(pageFetches).toBe(0);
  });
});

// --- caps ------------------------------------------------------------------

describe("caps are counted, never silent", () => {
  test("a huge spec is capped and says so in the header", () => {
    const paths: Record<string, unknown> = {};
    for (let i = 0; i < 1600; i++) paths[`/v1/r${String(i).padStart(4, "0")}`] = { get: {} };
    const facts = buildOpenApiFacts({
      openapi: "3.0.0",
      info: { title: "Big", version: "1" },
      paths,
    });
    expect(facts.operations).toHaveLength(1500);
    expect(facts.truncatedOperations).toBe(100);
    expect(
      buildOpenApiDoc(facts, { domain: "big.com", specUrl: "u" }).text.split("\n")[1],
    ).toContain("[capped: 100 endpoints not listed]");
  });

  test("a wide schema is capped and says so in its own line", () => {
    const properties: Record<string, unknown> = {};
    for (let i = 0; i < 70; i++) properties[`f${String(i).padStart(3, "0")}`] = {};
    const facts = buildOpenApiFacts({
      openapi: "3.0.0",
      info: { title: "W", version: "1" },
      paths: { "/x": { get: {} } },
      components: { schemas: { Wide: { properties } } },
    });
    expect(schemaLine(facts.schemas[0]!)).toContain("+10 more fields");
  });
});
