import * as cheerio from "cheerio";
import { parse as parseYaml } from "yaml";

/**
 * OpenAPI / Swagger spec discovery, normalisation and canonical rendering — the
 * `docs` source's mode 1 (the jackpot path). PURE: no network, no AI.
 *
 * The whole point is that the STRUCTURE is flattened into a canonical, sorted,
 * one-fact-per-line document. The pipeline's ordinary lexical differ then produces a
 * genuinely STRUCTURAL delta — an endpoint appearing is exactly one `+` line, a field
 * turning `deprecated` rewrites exactly its schema line — with zero AI spent on the
 * diff itself. AI is only ever paid for the "so what" downstream (classify → signal).
 *
 * Every line carries its own plain-English annotation (the `subdomains` doctrine):
 * the classifier reads `+`/`-` lines out of context, so a bare `POST /v1/foo` would
 * tell it nothing about what kind of move this is.
 */

// A spec that lists thousands of operations (Stripe, AWS) must not blow the 50KB
// diffText cap or drown a real change in noise. Truncation is COUNTED in the header
// line, so a capped spec never looks like a complete one.
const MAX_OPERATIONS = 1500;
const MAX_SCHEMAS = 400;
const MAX_FIELDS_PER_SCHEMA = 60;

/** HTTP verbs an OpenAPI path item may carry (everything else is metadata). */
const HTTP_METHODS = ["get", "put", "post", "delete", "options", "head", "patch", "trace"] as const;

// Pre-release vocabulary. Matched on the path + summary + tags, never inferred — a
// competitor shipping `/v2beta/` or a "Preview" tag is announcing work in flight.
// The leading `\d` alternative is what catches the version-suffix convention
// (`/v2beta/`, `/v1alpha1/`), where a plain \b never fires: the char before "beta"
// is a digit, so both sides are word characters. The trailing \b still keeps
// "alphabet" and "betamax" out.
const BETA_RE = /(?:\b|\d)(beta|preview|alpha|experimental|unstable|early[- ]access)\b/i;

/** The JSON-island id the docs scraper embeds. Single source of truth. */
export const DOCS_DOC_MARKER = "outrival-docs";

export interface OpenApiOperation {
  method: string;
  path: string;
  deprecated: boolean;
  beta: boolean;
  /** Parameter names, sorted. */
  params: string[];
}

export interface OpenApiField {
  name: string;
  deprecated: boolean;
}

export interface OpenApiSchema {
  name: string;
  fields: OpenApiField[];
  /** Fields dropped by MAX_FIELDS_PER_SCHEMA (surfaced in the line, never silent). */
  truncatedFields: number;
}

export interface OpenApiFacts {
  title: string;
  version: string;
  operations: OpenApiOperation[];
  schemas: OpenApiSchema[];
  /** Operations / schemas dropped by the caps (surfaced in the header line). */
  truncatedOperations: number;
  truncatedSchemas: number;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/**
 * Conventional spec locations to probe, relative to the docs root AND the site
 * origin. Ordered cheapest-most-likely first; the caller stops at the first parse.
 * Deduped by the caller.
 */
export function specCandidates(docsRoot: string, origin: string): string[] {
  const out: string[] = [];
  const rootRelative = [
    "openapi.json",
    "openapi.yaml",
    "openapi.yml",
    "swagger.json",
    "swagger.yaml",
    "spec.json",
  ];
  for (const rel of rootRelative) {
    try {
      // A trailing slash matters for relative resolution: `/docs` + `openapi.json`
      // must give `/docs/openapi.json`, not `/openapi.json`.
      const base = docsRoot.endsWith("/") ? docsRoot : `${docsRoot}/`;
      out.push(new URL(rel, base).toString());
    } catch {
      // unparseable root — the origin candidates below still apply
    }
  }
  const originAbsolute = [
    "/openapi.json",
    "/openapi.yaml",
    "/swagger.json",
    "/api/openapi.json",
    "/spec/openapi.json",
    "/api-docs/openapi.json",
    "/.well-known/openapi.json",
  ];
  for (const path of originAbsolute) {
    try {
      out.push(new URL(path, origin).toString());
    } catch {
      // ignore
    }
  }
  const seen = new Set<string>();
  return out.filter((u) => (seen.has(u) ? false : (seen.add(u), true)));
}

// A spec URL referenced by the docs page itself. Covers a plain link/script src and
// the attribute the three common spec renderers use to point at their spec
// (Redoc `spec-url`, Scalar/Stoplight `data-url` / `apiDescriptionUrl`).
const SPEC_HREF_RE = /(openapi|swagger)[\w.-]*\.(json|ya?ml)(\?|$)/i;
const SPEC_ATTRS = ["href", "src", "spec-url", "data-url", "apidescriptionurl", "data-spec-url"];

/**
 * Spec URLs the docs HTML itself points at, absolute and deduped. This is what
 * catches a spec published under a non-conventional path — the common case on a
 * hosted docs platform. Pure.
 */
export function findSpecLinks(html: string, base: string): string[] {
  let baseUrl: URL;
  try {
    baseUrl = new URL(base);
  } catch {
    return [];
  }
  const $ = cheerio.load(html);
  const seen = new Set<string>();
  const out: string[] = [];
  $("*").each((_, el) => {
    const attribs = (el as { attribs?: Record<string, string> }).attribs;
    if (!attribs) return;
    for (const [rawName, value] of Object.entries(attribs)) {
      if (!value || !SPEC_ATTRS.includes(rawName.toLowerCase())) continue;
      if (!SPEC_HREF_RE.test(value)) continue;
      let abs: string;
      try {
        abs = new URL(value, baseUrl).toString();
      } catch {
        continue;
      }
      if (seen.has(abs)) continue;
      seen.add(abs);
      out.push(abs);
    }
  });
  return out;
}

/**
 * Parse a candidate body into an OpenAPI/Swagger document, or null.
 *
 * Deliberately strict: the object must carry an `openapi`/`swagger` version AND a
 * `paths` object. A `package.json`, a Docusaurus config or an arbitrary YAML front
 * matter file sitting at a conventional path must NOT be mistaken for a spec — that
 * would pin the source into mode 1 forever with a hollow snapshot. Pure.
 */
export function parseSpec(text: string, url: string): Record<string, unknown> | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const looksJson = /\.json(\?|$)/i.test(url) || trimmed.startsWith("{");
  let parsed: unknown;
  try {
    parsed = looksJson ? JSON.parse(trimmed) : parseYaml(trimmed);
  } catch {
    return null;
  }
  const doc = asRecord(parsed);
  if (!doc) return null;
  const declaresVersion = str(doc.openapi) !== null || str(doc.swagger) !== null;
  if (!declaresVersion) return null;
  if (!asRecord(doc.paths)) return null;
  return doc;
}

/** Parameter names of one operation, merged with the path item's shared params. */
function paramNames(operation: Record<string, unknown>, shared: unknown): string[] {
  const names = new Set<string>();
  for (const source of [shared, operation.parameters]) {
    if (!Array.isArray(source)) continue;
    for (const raw of source) {
      const name = str(asRecord(raw)?.name);
      if (name) names.add(name);
    }
  }
  return Array.from(names).sort();
}

function isBeta(path: string, operation: Record<string, unknown>): boolean {
  if (BETA_RE.test(path)) return true;
  const summary = str(operation.summary) ?? "";
  const description = str(operation.description) ?? "";
  const tags = Array.isArray(operation.tags) ? operation.tags.filter((t) => typeof t === "string").join(" ") : "";
  return BETA_RE.test(`${summary} ${description} ${tags}`);
}

/** Schema properties, sorted, each flagged with its own `deprecated`. */
function schemaFields(schema: Record<string, unknown>): { fields: OpenApiField[]; truncated: number } {
  const properties = asRecord(schema.properties);
  if (!properties) return { fields: [], truncated: 0 };
  const all = Object.entries(properties)
    .map(([name, raw]) => ({ name, deprecated: asRecord(raw)?.deprecated === true }))
    .sort((a, b) => a.name.localeCompare(b.name));
  return {
    fields: all.slice(0, MAX_FIELDS_PER_SCHEMA),
    truncated: Math.max(0, all.length - MAX_FIELDS_PER_SCHEMA),
  };
}

/**
 * Flatten a parsed spec into sorted, capped facts. Sorting is what makes the
 * downstream lexical diff structural: same spec → same document, byte for byte, so
 * only a real change in the API produces a diff line. Pure.
 */
export function buildOpenApiFacts(spec: Record<string, unknown>): OpenApiFacts {
  const info = asRecord(spec.info);
  const paths = asRecord(spec.paths) ?? {};

  const operations: OpenApiOperation[] = [];
  for (const [path, rawItem] of Object.entries(paths)) {
    const item = asRecord(rawItem);
    if (!item) continue;
    for (const method of HTTP_METHODS) {
      const operation = asRecord(item[method]);
      if (!operation) continue;
      operations.push({
        method: method.toUpperCase(),
        path,
        deprecated: operation.deprecated === true,
        beta: isBeta(path, operation),
        params: paramNames(operation, item.parameters),
      });
    }
  }
  // Path first, then method: an endpoint's verbs stay grouped, so adding a verb to an
  // existing path is one adjacent `+` line rather than a line far from its siblings.
  operations.sort((a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method));

  // OpenAPI 3 puts models under components.schemas, Swagger 2 under definitions.
  const rawSchemas =
    asRecord(asRecord(spec.components)?.schemas) ?? asRecord(spec.definitions) ?? {};
  const schemas: OpenApiSchema[] = Object.entries(rawSchemas)
    .flatMap(([name, raw]) => {
      const schema = asRecord(raw);
      if (!schema) return [];
      const { fields, truncated } = schemaFields(schema);
      return [{ name, fields, truncatedFields: truncated }];
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  return {
    title: str(info?.title) ?? "API",
    version: str(info?.version) ?? "unversioned",
    operations: operations.slice(0, MAX_OPERATIONS),
    schemas: schemas.slice(0, MAX_SCHEMAS),
    truncatedOperations: Math.max(0, operations.length - MAX_OPERATIONS),
    truncatedSchemas: Math.max(0, schemas.length - MAX_SCHEMAS),
  };
}

// The strategic meaning attached to a state change, spelled out for the classifier.
const DEPRECATED_NOTE = "[DEPRECATED — the vendor is sunsetting this capability]";
const BETA_NOTE = "[BETA — a pre-release capability, not yet generally available]";

/** One canonical line per operation. Exported for the tests' readability. */
export function operationLine(op: OpenApiOperation): string {
  const marks = [op.deprecated ? DEPRECATED_NOTE : null, op.beta ? BETA_NOTE : null]
    .filter(Boolean)
    .join(" ");
  const params = op.params.length > 0 ? ` (params: ${op.params.join(", ")})` : "";
  return `${op.method} ${op.path} — API endpoint${marks ? ` ${marks}` : ""}${params}`;
}

/** One canonical line per schema, with per-field deprecation inline. */
export function schemaLine(schema: OpenApiSchema): string {
  const fields = schema.fields
    .map((f) => (f.deprecated ? `${f.name} ${DEPRECATED_NOTE}` : f.name))
    .join(", ");
  const more = schema.truncatedFields > 0 ? `, +${schema.truncatedFields} more fields` : "";
  return `schema ${schema.name} — data model fields: ${fields}${more}`;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** The JSON island every docs snapshot carries (debug + future structural reader). */
export function docsIsland(payload: unknown): string {
  const json = JSON.stringify(payload).replace(/</g, "\\u003c");
  return `<script type="application/json" id="${DOCS_DOC_MARKER}">${json}</script>`;
}

export interface DocsDocument {
  html: string;
  text: string;
}

/**
 * Render the canonical mode-1 snapshot. The first line is a STABLE grounding
 * sentence (it never diffs) that tells the classifier what surface this is, so a
 * lone `+ POST /v1/...` line lands as a product move rather than an unlabelled
 * string. The second line is the header: counts + the spec version + any truncation.
 */
export function buildOpenApiDoc(
  facts: OpenApiFacts,
  ctx: { domain: string; specUrl: string },
): DocsDocument {
  const deprecated = facts.operations.filter((o) => o.deprecated).length;
  const beta = facts.operations.filter((o) => o.beta).length;
  const truncation = [
    facts.truncatedOperations > 0 ? `${facts.truncatedOperations} endpoints not listed` : null,
    facts.truncatedSchemas > 0 ? `${facts.truncatedSchemas} schemas not listed` : null,
  ].filter(Boolean);

  const intro = `Developer API documentation for ${ctx.domain} — the endpoints, parameters and data models this vendor publishes. A new endpoint is a capability they built; a deprecated one is a capability they are removing.`;
  const header =
    `OpenAPI "${facts.title}" v${facts.version} — ${facts.operations.length} endpoints ` +
    `(${deprecated} deprecated, ${beta} beta), ${facts.schemas.length} schemas` +
    (truncation.length > 0 ? ` [capped: ${truncation.join(", ")}]` : "");

  const lines = [
    ...facts.operations.map(operationLine),
    ...facts.schemas.map(schemaLine),
  ];

  const text = [intro, header, ...lines].join("\n");
  const html =
    `<!doctype html><html><body><section data-outrival-docs="openapi">` +
    `<p>${escapeHtml(intro)}</p><h2>${escapeHtml(header)}</h2>` +
    `<ul>${lines.map((l) => `<li>${escapeHtml(l)}</li>`).join("")}</ul></section>` +
    docsIsland({ mode: "openapi", specUrl: ctx.specUrl, operations: facts.operations, schemas: facts.schemas }) +
    `</body></html>`;

  return { html, text };
}
