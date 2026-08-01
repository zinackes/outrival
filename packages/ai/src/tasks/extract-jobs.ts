import { z } from "zod";
import { complete } from "../provider";
import { AI_CONFIG } from "../config";
import { safeParseJson } from "../lib/parse";

export const JobPostingSchema = z.object({
  title: z.string(),
  department: z.string(),
  location: z.string().nullable(),
});

export const JobsSchema = z.object({
  jobs: z.array(JobPostingSchema),
});

export type ExtractedJob = z.infer<typeof JobPostingSchema>;
export type JobsExtraction = z.infer<typeof JobsSchema>;

// A careers page is marketing copy FIRST and a listing second: exotec.com/careers
// spends 7.6k characters on culture, teams and the site chrome before a single role
// appears. The old 10k window therefore cut the page mid-list on any real board, and
// the roles that fell outside it were extracted as "not open" — indistinguishable
// downstream from a closed posting. Sized to hold the copy AND a large listing;
// gpt-oss-120b reads 40k characters (~10k tokens) without trouble.
const MAX_PAGE_CHARS = 40000;

// Static half of the prompt (rules + output shape), byte-identical every call, sent
// as `system` ahead of the variable page so the providers can cache the prefix. See
// extract-pricing for why that matters more than the token saving: on Groq a cached
// token does not count against the per-minute ceiling. Never interpolate in here.
//
// Modest here on purpose: this prefix is ~177 tokens, 9% of the prompt, and a board's
// text dominates. It clears Cerebras' 128-token block granularity (where most of our
// traffic lands) and may fall under Groq's per-model minimum. Kept because it costs
// nothing and cannot hurt, not because it is where the saving is.
const EXTRACT_JOBS_SYSTEM = `<task>
Extract every job posting listed on this careers page.
- "title": exact title (e.g. "Senior Software Engineer")
- "department": standard category ("Engineering", "Sales", "Marketing",
  "Product", "Design", "Customer Success", "Operations", "Finance",
  "People", "Data", "Other"). Map variants to these.
- "location": city/country/Remote as displayed, or null
- Ignore non-posting links (testimonials, values, etc.)
- If there are no postings, return an empty "jobs" array

Reply ONLY with a valid JSON object, no markdown and no surrounding text.
</task>

<format>
{
  "jobs": [
    { "title": "e.g. Senior Backend Engineer", "department": "Engineering", "location": "e.g. Paris" }
  ]
}
</format>`;

export async function extractJobs(careersPageText: string): Promise<JobsExtraction | null> {
  const prompt = `<careers_page>
${careersPageText.slice(0, MAX_PAGE_CHARS)}
</careers_page>`;

  // A 56-role board already spends ~2k tokens of JSON; 4096 left no headroom, and an
  // answer cut mid-object fails the parse and drops the whole extraction.
  const raw = await complete(AI_CONFIG.classification, {
    system: EXTRACT_JOBS_SYSTEM,
    prompt,
    json: true,
    maxTokens: 8192,
  });
  const result = safeParseJson(raw, JobsSchema);
  if (!result.ok) {
    console.error("Jobs extraction parse failed:", result.error, "raw:", raw.slice(0, 500));
    return null;
  }
  return result.value;
}
