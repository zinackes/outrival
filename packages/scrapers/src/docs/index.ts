// Pure developer-docs parsing + rendering (OpenAPI facts, docs page lists) — AI-free.
// Imported via the "@outrival/scrapers/docs" subpath. The scraper itself stays behind
// getScraper; nothing outside this package needs to call it directly.
export {
  parseSpec,
  buildOpenApiFacts,
  buildOpenApiDoc,
  findSpecLinks,
  specCandidates,
  operationLine,
  schemaLine,
  docsIsland,
  DOCS_DOC_MARKER,
  type OpenApiFacts,
  type OpenApiOperation,
  type OpenApiSchema,
  type OpenApiField,
  type DocsDocument,
} from "./openapi";
export {
  filterDocsUrls,
  selectPagesToHash,
  hashDocsPages,
  buildDocsPagesDoc,
  pageHashEnabled,
  pageHashMax,
  type DocsPageHash,
} from "./pages";
export {
  discoverDocsRoot,
  looksLikeDocsUrl,
  docsLinkIn,
  type DocsRoot,
  type DocsRootSource,
  type DiscoverDeps,
} from "./discover";
