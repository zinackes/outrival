import { complete } from "../provider";
import { AI_CONFIG } from "../config";
import { safeParseJson } from "../lib/parse";
import { ProductProfileSchema, type ProductProfile } from "../tasks/analyze-product";
import { buildProfilePrompt } from "./profile-prompt";

/**
 * "Document" stage adapter: the caller has already extracted the raw text from a
 * pitch deck / business plan IN MEMORY (no storage). We keep the first ~10000
 * significant characters and derive a ProductProfile from them.
 *
 * Pure: receives text only — never a file/buffer. Zero-storage is enforced upstream.
 */
export async function fromDocument(
  extractedText: string,
): Promise<ProductProfile | null> {
  const text = condense(extractedText).slice(0, 10000);
  if (text.length < 50) return null;

  const prompt = buildProfilePrompt(
    `<document>\n${text}\n</document>`,
    "This text comes from a pitch deck or business plan. Profile the product it describes. Ignore cover pages, tables of contents and repetitions; focus on what the product actually does, for whom, and how it makes money.",
  );

  const raw = await complete(AI_CONFIG.classification, { prompt, json: true });
  const result = safeParseJson(raw, ProductProfileSchema);
  if (!result.ok) {
    console.error(
      "fromDocument parse failed:",
      result.error,
      "raw:",
      raw.slice(0, 500),
    );
    return null;
  }
  return result.value;
}

/** Collapse runs of whitespace and drop duplicate consecutive lines. */
function condense(raw: string): string {
  const lines = raw
    .split(/\r?\n/)
    .map((l) => l.replace(/[ \t]+/g, " ").trim());
  const out: string[] = [];
  let prev = "";
  for (const l of lines) {
    if (!l) continue;
    if (l === prev) continue;
    out.push(l);
    prev = l;
  }
  return out.join("\n");
}
