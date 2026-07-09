// Jobs diffing decision (extracted from extract-jobs.job.ts so it can be tested).
//
// C1 guard: an empty jobs extraction only means "every posting closed" when the
// emptiness is AUTHORITATIVE — i.e. a public ATS API returned a definitive board
// list. On the fallback path `jobs=[]` can only come from the AI floor (the
// structured/cache/heal stages are gated on jobs.length>0), and an ATS timeout,
// an SPA "Loading positions…" placeholder, or an AI {jobs:[]} all yield [] with
// no real closure. Mass-closing every active posting on that fires a phantom
// "hiring freeze" signal (and its inverse on the next scrape). So when the result
// is empty and NOT authoritative we skip the whole close/count/summary path.
//
// Closure guard (generalises C1): ANY closure — empty→close-all OR partial→close-
// the-missing — requires the AUTHORITATIVE path. A non-authoritative extraction
// (AI floor / careers HTML) can return a partial SUBSET (a truncated page, a flaky
// render), so trusting its omissions to close postings fabricates "role removed"
// events exactly like the empty case does. On that path we ADD only, never close;
// principled fallback-path closure returns with the R1 completeness signal.

export function jobKey(title: string, department: string): string {
  return `${title.trim().toLowerCase()}::${department.trim().toLowerCase()}`;
}

export interface ExistingPosting {
  id: string;
  title: string;
  department: string | null;
}

export interface JobsDelta<J> {
  /** Empty non-authoritative extraction → no-op for this scrape (C1). */
  skip: boolean;
  inserts: J[];
  closedIds: string[];
}

export function computeJobsDelta<J extends { title: string; department: string }>(
  existing: ExistingPosting[],
  jobs: J[],
  authoritative: boolean,
): JobsDelta<J> {
  if (jobs.length === 0 && !authoritative) {
    return { skip: true, inserts: [], closedIds: [] };
  }

  const existingByKey = new Map(
    existing.map((j) => [jobKey(j.title, j.department ?? "Other"), j]),
  );

  const seenKeys = new Set<string>();
  const inserts: J[] = [];
  for (const j of jobs) {
    const key = jobKey(j.title, j.department);
    if (seenKeys.has(key)) continue;
    seenKeys.add(key);
    if (!existingByKey.has(key)) inserts.push(j);
  }

  // Only an authoritative board list may close postings (see header). A non-
  // authoritative subset adds new roles but never closes the ones it didn't see.
  const closedIds = authoritative
    ? existing
        .filter((j) => !seenKeys.has(jobKey(j.title, j.department ?? "Other")))
        .map((j) => j.id)
    : [];

  return { skip: false, inserts, closedIds };
}
