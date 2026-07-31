import { z } from "zod";
import { complete } from "../provider";
import { AI_CONFIG } from "../config";
import { safeParseJson } from "../lib/parse";

/**
 * Mine facts out of a BATCH of job descriptions (Hiring Intelligence v2 P1).
 *
 * What a competitor writes in a JD is the earliest public statement of what they
 * are building: the database they are migrating to, the team they are standing
 * up, the market they are opening. It is also the easiest place in the product
 * for a model to invent something plausible, which is why every claim must carry
 * the sentence it came from and why NOTHING here decides what survives — the
 * caller re-checks each snippet against the JD and drops what isn't in it
 * (`applyFactGuards`, @outrival/scrapers/jobs-jd-facts).
 *
 * Batched by design: ~10 JDs per call keeps the cost of a fresh 40-role board at
 * four calls instead of forty, and the postings are independent so nothing is
 * lost by reading them together.
 */

export const MinedFactSchema = z.object({
  kind: z.enum(["tech", "product_hint", "team_size", "market", "language"]),
  value: z.string(),
  /** The sentence, copied from the JD. Verified as a substring by the caller. */
  evidence_snippet: z.string(),
  confidence: z.number().min(0).max(1).nullable().optional(),
});

export const MinedPostingSchema = z.object({
  /** Index into the batch passed in — ids are not sent, so they can't be mangled. */
  index: z.number().int(),
  facts: z.array(MinedFactSchema),
});

export const JobFactsSchema = z.object({
  postings: z.array(MinedPostingSchema),
});

export type MinedFactRaw = z.infer<typeof MinedFactSchema>;
export type JobFactsExtraction = z.infer<typeof JobFactsSchema>;

export interface JobDescriptionInput {
  title: string;
  description: string;
}

/**
 * How much of each JD the model sees. A description is stored capped at 15k, but
 * ten of those in one prompt would be 150k characters. The facts we want live in
 * the responsibilities and requirements, which are near the top; the tail is
 * benefits and equal-opportunity boilerplate.
 */
const MAX_JD_CHARS = 4500;

export async function mineJobFacts(
  batch: ReadonlyArray<JobDescriptionInput>,
): Promise<JobFactsExtraction | null> {
  if (batch.length === 0) return { postings: [] };

  const docs = batch
    .map(
      (j, i) =>
        `<posting index="${i}">\n<title>${j.title}</title>\n<description>\n${j.description.slice(
          0,
          MAX_JD_CHARS,
        )}\n</description>\n</posting>`,
    )
    .join("\n\n");

  const prompt = `<job_postings>
${docs}
</job_postings>

<task>
You are reading a competitor's job descriptions to extract FACTS they state about
themselves. Return one entry per posting index, with the facts you found in it.

Fact kinds:
- "tech": a named third-party technology, language, framework, database, cloud or
  vendor the company says it USES or is ADOPTING. Not a nice-to-have list of every
  tool in the industry, and never the candidate's generic skills ("APIs", "testing").
  value = the technology's common name, e.g. "Kubernetes", "Snowflake", "Rust".
- "product_hint": something the company says it is BUILDING that it has not
  announced — a new team, a new product line, a rebuild, an upcoming launch.
  value = a short noun phrase naming the initiative, e.g. "new payments platform".
- "team_size": a stated size of a team or of the company. value = the number and
  what it counts, e.g. "engineering team of 25".
- "market": a country, region or industry segment they say they are entering or
  expanding into. value = the market, e.g. "Germany", "healthcare".
- "language": a human language the role requires beyond English. value = the
  language, e.g. "German".

RULES — these decide whether your answer is usable:
- "evidence_snippet" MUST be copied WORD FOR WORD from that posting's description.
  Do not paraphrase it, do not fix its grammar, do not join two sentences. A
  snippet that is not in the text is discarded and the fact with it.
- Copy a whole sentence or clause (at least a dozen characters), not a fragment.
- Only state a "product_hint" when the description itself says something is new,
  upcoming or being built from scratch. Ambition, growth and "scale our platform"
  are not initiatives.
- If a posting states no facts, return it with an empty "facts" array.
- Return at most 5 facts per posting, the most specific ones.
- "confidence" is your own 0-1 estimate.

Reply ONLY with a valid JSON object, no markdown and no surrounding text.
</task>

<format>
{
  "postings": [
    {
      "index": 0,
      "facts": [
        {
          "kind": "tech",
          "value": "Kubernetes",
          "evidence_snippet": "You will operate our services on Kubernetes across three regions.",
          "confidence": 0.9
        }
      ]
    }
  ]
}
</format>`;

  const raw = await complete(AI_CONFIG.classification, { prompt, json: true, maxTokens: 6144 });
  const result = safeParseJson(raw, JobFactsSchema);
  if (!result.ok) {
    console.error("Job facts mining parse failed:", result.error, "raw:", raw.slice(0, 500));
    return null;
  }
  return result.value;
}
