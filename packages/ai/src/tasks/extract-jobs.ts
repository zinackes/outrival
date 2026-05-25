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
Extrais toutes les offres d'emploi listées sur cette page carrières.
- "title" : intitulé exact (ex: "Senior Software Engineer")
- "department" : catégorie standard ("Engineering", "Sales", "Marketing",
  "Product", "Design", "Customer Success", "Operations", "Finance",
  "People", "Data", "Other"). Mappe les variantes.
- "location" : ville/pays/Remote tel qu'affiché, ou null
- Ignore les liens hors offre (témoignages, valeurs, etc.)
- Si aucune offre, renvoie un tableau "jobs" vide

Réponds UNIQUEMENT avec un objet JSON valide, sans markdown ni texte autour.
</task>

<format>
{
  "jobs": [
    { "title": "Senior Backend Engineer", "department": "Engineering", "location": "Paris" }
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
