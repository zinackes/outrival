import { complete } from "../provider";
import { AI_CONFIG } from "../config";
import { safeParseJson } from "../lib/parse";
import { ProductProfileSchema, type ProductProfile } from "../tasks/analyze-product";

/**
 * Structured artefacts gathered from a public GitHub repo by the caller (API layer).
 * Pure package: we never fetch here, we only reason about already-fetched inputs.
 */
export interface RepoArtifacts {
  readme: string | null;
  packageJson: Record<string, unknown> | null;
  topLevelDirs: string[];
  envExample: string | null;
  docsExcerpt: string | null;
}

/**
 * "Developing" stage adapter: infer the product from code artefacts.
 * - README is the primary source of the product promise.
 * - package.json dependencies hint the stack and therefore the product type.
 * - /src top-level structure hints the feature surface.
 */
export async function fromRepo(
  artifacts: RepoArtifacts,
): Promise<ProductProfile | null> {
  const deps = artifacts.packageJson
    ? Object.keys({
        ...(artifacts.packageJson.dependencies as Record<string, unknown> | undefined),
        ...(artifacts.packageJson.devDependencies as Record<string, unknown> | undefined),
      })
    : [];
  const pkgName =
    typeof artifacts.packageJson?.name === "string"
      ? (artifacts.packageJson.name as string)
      : null;
  const pkgDescription =
    typeof artifacts.packageJson?.description === "string"
      ? (artifacts.packageJson.description as string)
      : null;

  const prompt = `<repo>
${pkgName ? `name: ${pkgName}` : ""}
${pkgDescription ? `description: ${pkgDescription}` : ""}
dependencies: ${deps.slice(0, 60).join(", ") || "(unknown)"}
top-level dirs: ${artifacts.topLevelDirs.slice(0, 40).join(", ") || "(unknown)"}
${artifacts.envExample ? `\nenv example:\n${artifacts.envExample.slice(0, 1000)}` : ""}
${artifacts.readme ? `\nreadme:\n${artifacts.readme.slice(0, 6000)}` : ""}
${artifacts.docsExcerpt ? `\ndocs:\n${artifacts.docsExcerpt.slice(0, 2000)}` : ""}
</repo>

<task>
This GitHub repo is a product under development. Infer its profile.
Use the README as the primary source of the product promise, the dependencies to
infer the stack and product type, and the structure to guess the features.
Reply ONLY with a valid JSON object, no markdown and no surrounding text.
Write all text values in English.
</task>

<format>
{
  "category": "e.g. B2B SaaS / DevTools",
  "audience": "e.g. Backend developers",
  "valueProp": "e.g. Automating X, in one sentence",
  "pricingModel": "e.g. Open-source + paid cloud"
}
</format>`;

  const raw = await complete(AI_CONFIG.classification, { prompt, json: true });
  const result = safeParseJson(raw, ProductProfileSchema);
  if (!result.ok) {
    console.error(
      "fromRepo parse failed:",
      result.error,
      "raw:",
      raw.slice(0, 500),
    );
    return null;
  }
  return result.value;
}
