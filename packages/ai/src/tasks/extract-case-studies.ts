import { z } from "zod";
import { complete } from "../provider";
import { AI_CONFIG } from "../config";
import { safeParseJson } from "../lib/parse";

/**
 * Read a BATCH of a competitor's customer stories (Content Intelligence v2 P3).
 *
 * A case study is prose written to persuade, and the four things worth having out
 * of it are buried in it: which customer, in which market, doing what, and which
 * number they were willing to print. Nothing about that shape is regular enough to
 * parse — the customer is named in the headline on one site, in a pull quote on the
 * next, and nowhere at all on a third ("a leading European bank").
 *
 * Everything it returns is a PROPOSAL. `applyCaseStudyGuards`
 * (@outrival/scrapers/content) decides what survives: the customer name and every
 * claimed metric must be findable in the page's own text. Those checks are in code
 * because of what they gate — a name becomes a permanent registry row and a "new
 * customer" alert, and a metric gets quoted back to the reader as something the
 * competitor said in public.
 *
 * Batched at ~5 pages per call: case studies are long, so the batch is half the
 * blog's, and the pages are independent, so a run of ten costs two calls.
 */

export const ExtractedCaseStudySchema = z.object({
  /** Index into the batch passed in — row ids are never sent, so none can be mangled. */
  index: z.number().int(),
  /**
   * The customer's name EXACTLY as the page writes it, or null when the story is
   * anonymised. Null is a correct, common answer, not a failure.
   */
  customer_name: z.string().nullable(),
  /** The market in the page's own words ("regional insurance broker"), or null. */
  customer_industry_label: z.string().nullable(),
  /** One short line on what they used the product for. */
  use_case: z.string().nullable(),
  /** Result claims, copied word for word. Substring-checked by the caller. */
  metrics_claimed: z.array(z.string()).default([]),
});

export const ExtractedCaseStudiesSchema = z.object({
  studies: z.array(ExtractedCaseStudySchema),
});

export type ExtractedCaseStudy = z.infer<typeof ExtractedCaseStudySchema>;
export type ExtractedCaseStudies = z.infer<typeof ExtractedCaseStudiesSchema>;

export interface CaseStudyForExtraction {
  title: string;
  /** The fetched page text, chrome stripped. */
  text: string;
}

/** How much of one story the model sees. A long case study fits inside this. */
const MAX_STUDY_CHARS = 6000;

export async function extractCaseStudies(
  batch: ReadonlyArray<CaseStudyForExtraction>,
): Promise<ExtractedCaseStudies | null> {
  if (batch.length === 0) return { studies: [] };

  const docs = batch
    .map(
      (s, i) =>
        `<page index="${i}">\n<title>${s.title}</title>\n<body>\n${s.text.slice(
          0,
          MAX_STUDY_CHARS,
        )}\n</body>\n</page>`,
    )
    .join("\n\n");

  const prompt = `<case_studies>
${docs}
</case_studies>

<task>
You are reading customer stories published by a software company. For each page, say
which customer it is about, what market that customer is in, what they used the
product for, and which results the page claims.

RULES — these decide whether your answer is usable:
- Return one entry per index given, and no index that was not given.
- "customer_name" is the customer's name EXACTLY as the page writes it. If the page
  never names them ("a leading European bank", "one of the largest retailers"),
  return null. Never turn a description into a name. Never return the company whose
  site this is — they are the vendor, not the customer.
- "customer_industry_label" is the customer's market in the page's own words
  ("insurance broker", "e-commerce", "hôpital public"). Null if the page says
  nothing about their market. Do not infer it from the vendor's own positioning.
- "use_case" is one short sentence, at most 20 words, in English, on what the
  customer used the product for.
- "metrics_claimed" lists the RESULT claims the page makes, each copied WORD FOR
  WORD from the body ("reduced churn by 32%", "3x faster onboarding"). Do not
  paraphrase, do not translate, do not convert units, do not join two sentences.
  Return an empty list when the page claims no numbers — that is a normal answer.
- A page that is not a customer story at all (a pricing page, an index listing many
  customers) gets null for every field and an empty metrics list.

Reply ONLY with a valid JSON object, no markdown and no surrounding text.
</task>

<format>
{
  "studies": [
    {
      "index": 0,
      "customer_name": "Acme Logistics",
      "customer_industry_label": "freight forwarding",
      "use_case": "Replacing spreadsheets for shipment tracking across three warehouses.",
      "metrics_claimed": ["cut manual data entry by 70%", "onboarded 400 drivers in 6 weeks"]
    }
  ]
}
</format>`;

  const raw = await complete(AI_CONFIG.classification, { prompt, json: true, maxTokens: 3072 });
  const result = safeParseJson(raw, ExtractedCaseStudiesSchema);
  if (!result.ok) {
    console.error("Case study extraction parse failed:", result.error, "raw:", raw.slice(0, 500));
    return null;
  }
  return result.value;
}
