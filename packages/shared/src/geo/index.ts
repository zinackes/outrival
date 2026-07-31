// Offline geo resolution. Imported as `@outrival/shared/geo`, NOT re-exported from
// the package barrel: the committed dataset is ~530 kB and only the worker (and the
// one-off baseline backfill) resolves locations. Web renders country CODES, and
// `Intl.DisplayNames` turns those into labels in the browser for free — so no bundle
// anywhere has a reason to carry this.
export { resolveLocation, type GeoResolution, type ResolvedLocation } from "./resolve";
export { normalizeGeoKey } from "./normalize";
export { GEO_DATASET_META } from "./dataset.generated";
