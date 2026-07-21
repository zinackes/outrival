import { z } from "zod";
import { complete } from "../provider";
import { AI_CONFIG } from "../config";
import { safeParseJson } from "../lib/parse";
import type { Claim } from "./types";

// Step 3: the binary judge. It only ever sees the claims the fuzzy validator could
// not settle — a quote that doesn't occur in the source is either a legitimate
// paraphrase or an invention, and only a reader can tell them apart.
//
// BINARY BY CONSTRUCTION: the schema accepts a boolean and a one-line reason,
// nothing else. A 1-5 scale would push the decision back onto whoever reads the
// number later, which is exactly the ambiguity this gate exists to remove.

/** The binary contract, exported so "no scale ever gets in" is a tested property. */
export const JudgeSchema = z.object({
  faithful: z.boolean(),
  reason: z.string(),
});

export interface ClaimJudgement {
  faithful: boolean;
  reason: string;
}

const SOURCE_CHARS = 12_000;

const JUDGE_SYSTEM = `You fact-check ONE claim written by an AI against the source it was written from.

Answer "faithful": true when the source really establishes the claim — including when the claim restates it in different words, summarises it, or combines two passages that are both present. Rewording is not an error.

Answer "faithful": false when the source does not establish it: a fact absent from the source, a number/date/name that appears nowhere, a comparison the source only supports for one side, or a statement built on the ABSENCE of data ("pricing is not public", "no reviews captured").

You are judging the CLAIM against the SOURCE only. Never use outside knowledge about these companies — treat your own memory as unreliable.

Answer with the boolean. Do NOT return a score, a percentage or a 1-5 scale.

Reply ONLY with a valid JSON object, no markdown and no surrounding text.
Write all text values in English.

<format>
{ "faithful": true|false, "reason": "one short sentence" }
</format>`;

export function buildJudgePrompt(claim: Claim, sourceText: string): string {
  return `<claim>
${claim.text}
</claim>

<quote_the_ai_offered>
${claim.citedQuote || "(none — the AI offered no supporting quote)"}
</quote_the_ai_offered>

<source>
${sourceText.slice(0, SOURCE_CHARS)}
</source>`;
}

/** Returns null on a parse miss / provider failure — the caller must fail OPEN. */
export async function judgeClaim(
  claim: Claim,
  sourceText: string,
): Promise<ClaimJudgement | null> {
  // SMART tier, not fast — measured, not assumed. On the pool's fast model
  // (gpt-oss-20b) the judge accepted a claim built on the ABSENCE of data ("their
  // enterprise pricing is not publicly available") by reading "Enterprise — contact
  // sales" as support for it: 5/6 inventions rejected, i.e. exactly the failure this
  // gate exists to stop, and one the prompt already names explicitly. The 120b model
  // rejects it (6/6). The judge is the low-volume half of the chain — it only runs on
  // claims the free fuzzy pass could not settle — so the tier costs little here,
  // while claim extraction (one call per gated output) stays on fast.
  const raw = await complete(AI_CONFIG.classification, {
    system: JUDGE_SYSTEM,
    prompt: buildJudgePrompt(claim, sourceText),
    json: true,
    maxTokens: 256,
  });
  const parsed = safeParseJson(raw, JudgeSchema);
  if (!parsed.ok) {
    console.error("faithfulness judge_claim parse failed:", parsed.error);
    return null;
  }
  return parsed.value;
}
