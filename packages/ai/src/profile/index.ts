// Onboarding product-profile adapters. Four input modes, one shared output type.
// All are pure: they take already-extracted text/artefacts and return a ProductProfile.
export { fromDescription } from "./from-description";
export type { FromDescriptionInput } from "./from-description";
export { fromDocument } from "./from-document";
export { fromRepo } from "./from-repo";
export type { RepoArtifacts } from "./from-repo";
export { fromUrl } from "./from-url";

// Shared output type/schema (single source of truth lives in tasks/analyze-product).
export { ProductProfileSchema, type ProductProfile } from "../tasks/analyze-product";
