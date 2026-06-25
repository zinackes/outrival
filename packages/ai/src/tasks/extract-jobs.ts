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

export async function extractJobs(careersPageText: string): Promise<JobsExtraction | null> {
  const prompt = `<careers_page>
${careersPageText.slice(0, 10000)}
</careers_page>

<task>
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

  const raw = await complete(AI_CONFIG.classification, { prompt, json: true, maxTokens: 4096 });
  const result = safeParseJson(raw, JobsSchema);
  if (!result.ok) {
    console.error("Jobs extraction parse failed:", result.error, "raw:", raw.slice(0, 500));
    return null;
  }
  return result.value;
}
