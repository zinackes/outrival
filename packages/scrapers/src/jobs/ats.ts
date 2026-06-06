/**
 * ATS (Applicant Tracking System) resolution for the jobs source.
 *
 * Most competitors don't host their openings on their own careers page — they
 * embed or link out to an ATS (Greenhouse, Lever, Ashby, …). Scraping only the
 * careers page therefore misses the actual postings. This module detects the ATS
 * from the careers page HTML, extracts the board token, and pulls the postings
 * from the ATS's PUBLIC, unauthenticated JSON API — structured, accurate, no
 * browser, no anti-bot, and carrying the real apply URL.
 *
 * PURE: `fetch` + regex only, no Patchright/cheerio. Exposed as the
 * `@outrival/scrapers/jobs-ats` subpath so the worker can parse the island the
 * scraper embeds (see `parseAtsJobsFromHtml`) without pulling the browser stack.
 */

export interface AtsJob {
  title: string;
  department: string;
  location: string | null;
  url: string | null;
  // patch-32 hiring enrichment — populated when the ATS exposes it, null otherwise.
  // Salary is mandatory in NYC/CA/CO/WA + the EU pay-transparency directive, so it
  // is increasingly present and reads as a seniority/budget signal. Seniority is
  // canonicalised (see `normalizeSeniority`); postedAt is an ISO date string.
  seniority: Seniority | null;
  postedAt: string | null;
  salaryMin: number | null;
  salaryMax: number | null;
  salaryCurrency: string | null;
}

export interface AtsBoard {
  /** Provider name, e.g. "greenhouse". */
  provider: string;
  /** Board token (the company slug on the ATS). */
  token: string;
  /** Public board URL to follow as a one-hop fallback when no API is available. */
  boardUrl: string;
}

// Marker id of the JSON island the scraper embeds in the snapshot HTML so
// extract-jobs can map the postings straight to job_postings (skip the LLM).
export const ATS_JOBS_MARKER = "outrival-ats-jobs";

function str(x: unknown): string {
  return typeof x === "string" ? x.trim() : "";
}

// Canonical seniority buckets, ordered low→high. Free-text ATS labels and job
// titles map onto these so a cross-ATS feed stays comparable.
export const SENIORITY_LEVELS = [
  "intern", "junior", "mid", "senior", "staff", "principal", "lead", "executive",
] as const;
export type Seniority = (typeof SENIORITY_LEVELS)[number];

const CURRENCY_SYMBOLS: Record<string, string> = { "$": "USD", "€": "EUR", "£": "GBP", "₹": "INR" };

/** Parse a single salary number that may carry a K/M suffix and grouping separators. */
function parseSalaryNumber(raw: string): number | null {
  const m = /(\d[\d.,]*)\s*([kmKM])?/.exec(raw);
  if (!m?.[1]) return null;
  const digits = m[1].replace(/,/g, "");
  const n = Number.parseFloat(digits);
  if (!Number.isFinite(n)) return null;
  const suffix = m[2]?.toLowerCase();
  if (suffix === "k") return n * 1_000;
  if (suffix === "m") return n * 1_000_000;
  return n;
}

export interface NormalizedSalary {
  min: number | null;
  max: number | null;
  currency: string | null;
}

/**
 * Normalise a salary into `{ min, max, currency }`. Accepts either a structured
 * range object (Lever/Recruitee shape: `{ min, max, currency, interval }`) or a
 * free-text summary (Ashby/Greenhouse: "$120K – $160K", "€80k", "150,000 USD").
 * Best-effort and total: returns all-null when nothing parseable is found, never
 * throws — a missing salary must never break the jobs path.
 */
export function normalizeSalary(input: unknown): NormalizedSalary {
  const empty: NormalizedSalary = { min: null, max: null, currency: null };
  if (input == null) return empty;

  // Structured range object.
  if (typeof input === "object") {
    const o = input as Record<string, unknown>;
    const min = typeof o.min === "number" ? o.min : Number.parseFloat(str(o.min)) || null;
    const max = typeof o.max === "number" ? o.max : Number.parseFloat(str(o.max)) || null;
    const currency = str(o.currency).toUpperCase() || null;
    if (min != null || max != null) {
      return { min: min || null, max: max || null, currency };
    }
    return empty;
  }

  if (typeof input !== "string") return empty;
  const text = input.trim();
  if (!text) return empty;

  // Currency: a 3-letter ISO code anywhere, else the first known symbol.
  let currency: string | null = null;
  const iso = /\b([A-Z]{3})\b/.exec(text.toUpperCase());
  if (iso?.[1] && iso[1] !== "AND") currency = iso[1];
  if (!currency) {
    for (const [sym, code] of Object.entries(CURRENCY_SYMBOLS)) {
      if (text.includes(sym)) { currency = code; break; }
    }
  }

  // Numbers (with optional K/M suffix). First two become min/max.
  const nums = Array.from(text.matchAll(/(\d[\d.,]*)\s*([kmKM])?/g))
    .map((m) => parseSalaryNumber(m[0]))
    .filter((n): n is number => n != null && n > 0);
  if (nums.length === 0) return { min: null, max: null, currency };
  const min = nums[0] ?? null;
  const max = nums.length > 1 ? (nums[1] ?? null) : null;
  return { min, max: max != null && max < (min ?? 0) ? null : max, currency };
}

const SENIORITY_PATTERNS: ReadonlyArray<[RegExp, Seniority]> = [
  [/\bintern(ship)?\b|\btrainee\b|\bapprentice\b/i, "intern"],
  [/\bjunior\b|\bjr\.?\b|\bentry[- ]?level\b|\bgraduate\b/i, "junior"],
  [/\bvp\b|\bvice president\b|\bhead of\b|\bdirector\b|\bchief\b|\bc[teo]o\b|\bexecutive\b/i, "executive"],
  [/\bprincipal\b/i, "principal"],
  [/\bstaff\b/i, "staff"],
  [/\blead\b|\bmanager\b|\bmgr\.?\b/i, "lead"],
  [/\bsenior\b|\bsr\.?\b|\bsenior\b/i, "senior"],
  [/\bmid[- ]?level\b|\bintermediate\b/i, "mid"],
];

/**
 * Map an ATS seniority label and/or a job title onto a canonical bucket. The
 * explicit ATS field wins; otherwise it is inferred from the title. Null when
 * nothing matches (we never guess "mid" — absence is informative).
 */
export function normalizeSeniority(title: string, raw?: string | null): Seniority | null {
  const hay = `${raw ?? ""} ${title}`;
  for (const [re, level] of SENIORITY_PATTERNS) {
    if (re.test(hay)) return level;
  }
  return null;
}

/** Build a fully-shaped AtsJob from a partial, filling enrichment defaults. */
function mkJob(p: {
  title: string;
  department?: string;
  location?: string | null;
  url?: string | null;
  seniority?: Seniority | null;
  postedAt?: string | null;
  salary?: NormalizedSalary | null;
}): AtsJob {
  const salary = p.salary ?? { min: null, max: null, currency: null };
  return {
    title: p.title.trim(),
    department: (p.department ?? "").trim() || "Other",
    location: p.location ?? null,
    url: p.url ?? null,
    seniority: p.seniority ?? normalizeSeniority(p.title),
    postedAt: p.postedAt ?? null,
    salaryMin: salary.min,
    salaryMax: salary.max,
    salaryCurrency: salary.currency,
  };
}

/** Coerce an ISO-ish date/epoch into an ISO date string, or null. */
function toIso(x: unknown): string | null {
  if (x == null) return null;
  const d = typeof x === "number" ? new Date(x) : new Date(str(x));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** Read the text of the first `<tag>…</tag>` in an XML block, unwrapping CDATA. */
function xmlTag(block: string, tag: string): string {
  const m = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`, "i").exec(block);
  if (!m?.[1]) return "";
  return m[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").trim();
}

interface ProviderDef {
  name: string;
  /** Each regex captures the board token in group 1. First match wins. */
  patterns: RegExp[];
  boardUrl: (token: string) => string;
  api?: {
    url: (token: string) => string;
    /** Response format. "xml" providers (Personio) receive the raw text string
     *  in `parse`; "json" (default) receive the parsed JSON value. */
    format?: "json" | "xml";
    parse: (data: unknown, token: string) => AtsJob[];
  };
}

const PROVIDERS: ProviderDef[] = [
  {
    name: "greenhouse",
    patterns: [
      /(?:boards|job-boards)\.greenhouse\.io\/embed\/job_board(?:\/js)?\?(?:[^"'\s]*&)?for=([a-z0-9][a-z0-9_-]{1,49})/i,
      /(?:boards|job-boards)\.greenhouse\.io\/([a-z0-9][a-z0-9_-]{1,49})/i,
    ],
    boardUrl: (t) => `https://boards.greenhouse.io/${t}`,
    api: {
      url: (t) => `https://boards-api.greenhouse.io/v1/boards/${t}/jobs?content=true`,
      parse: (data) => {
        const jobs = (data as { jobs?: unknown })?.jobs;
        if (!Array.isArray(jobs)) return [];
        return jobs
          .map((j: Record<string, unknown>) => {
            const title = str(j?.title);
            return mkJob({
              title,
              department: str((j?.departments as { name?: unknown }[] | undefined)?.[0]?.name),
              location: str((j?.location as { name?: unknown } | undefined)?.name) || null,
              url: str(j?.absolute_url) || null,
              postedAt: toIso(j?.first_published ?? j?.updated_at),
            });
          })
          .filter((j) => j.title);
      },
    },
  },
  {
    name: "lever",
    patterns: [
      /jobs\.lever\.co\/([a-z0-9][a-z0-9_-]{1,49})/i,
      /(?:api\.)?lever\.co\/(?:v0\/)?postings\/([a-z0-9][a-z0-9_-]{1,49})/i,
    ],
    boardUrl: (t) => `https://jobs.lever.co/${t}`,
    api: {
      url: (t) => `https://api.lever.co/v0/postings/${t}?mode=json`,
      parse: (data) => {
        if (!Array.isArray(data)) return [];
        return data
          .map((p: Record<string, unknown>) => {
            const cat = (p?.categories as Record<string, unknown>) ?? {};
            const title = str(p?.text);
            return mkJob({
              title,
              department: str(cat.team) || str(cat.department),
              location: str(cat.location) || null,
              url: str(p?.hostedUrl) || str(p?.applyUrl) || null,
              postedAt: toIso(p?.createdAt),
              // Lever carries a structured range when comp is disclosed.
              salary: normalizeSalary(p?.salaryRange ?? p?.salaryDescriptionPlain),
              seniority: normalizeSeniority(title, str(cat.commitment)),
            });
          })
          .filter((j) => j.title);
      },
    },
  },
  {
    name: "ashby",
    patterns: [/jobs\.ashbyhq\.com\/([a-z0-9][a-z0-9._-]{1,49})/i],
    boardUrl: (t) => `https://jobs.ashbyhq.com/${t}`,
    api: {
      url: (t) => `https://api.ashbyhq.com/posting-api/job-board/${t}?includeCompensation=true`,
      parse: (data) => {
        const jobs = (data as { jobs?: unknown })?.jobs;
        if (!Array.isArray(jobs)) return [];
        return jobs
          .filter((j: Record<string, unknown>) => j?.isListed !== false)
          .map((j: Record<string, unknown>) => {
            const title = str(j?.title);
            const comp = j?.compensation as { compensationTierSummary?: unknown } | undefined;
            return mkJob({
              title,
              department: str(j?.department) || str(j?.team),
              location: str(j?.location) || null,
              url: str(j?.jobUrl) || str(j?.applyUrl) || null,
              postedAt: toIso(j?.publishedDate ?? j?.publishedAt),
              salary: normalizeSalary(comp?.compensationTierSummary),
              seniority: normalizeSeniority(title, str(j?.employmentType)),
            });
          })
          .filter((j) => j.title);
      },
    },
  },
  {
    name: "smartrecruiters",
    patterns: [/(?:jobs|careers)\.smartrecruiters\.com\/([a-z0-9][a-z0-9_-]{1,49})/i],
    boardUrl: (t) => `https://jobs.smartrecruiters.com/${t}`,
    api: {
      url: (t) => `https://api.smartrecruiters.com/v1/companies/${t}/postings?limit=100`,
      parse: (data, token) => {
        const content = (data as { content?: unknown })?.content;
        if (!Array.isArray(content)) return [];
        return content
          .map((p: Record<string, unknown>) => {
            const loc = (p?.location as Record<string, unknown>) ?? {};
            const location = [str(loc.city), str(loc.country)].filter(Boolean).join(", ");
            const title = str(p?.name);
            return mkJob({
              title,
              department:
                str((p?.department as { label?: unknown } | undefined)?.label) ||
                str((p?.function as { label?: unknown } | undefined)?.label),
              location: location || null,
              url: str(p?.id) ? `https://jobs.smartrecruiters.com/${token}/${str(p?.id)}` : null,
              postedAt: toIso(p?.releasedDate),
              seniority: normalizeSeniority(
                title,
                str((p?.experienceLevel as { label?: unknown } | undefined)?.label),
              ),
            });
          })
          .filter((j) => j.title);
      },
    },
  },
  {
    name: "recruitee",
    patterns: [/([a-z0-9][a-z0-9_-]{1,49})\.recruitee\.com/i],
    boardUrl: (t) => `https://${t}.recruitee.com`,
    api: {
      url: (t) => `https://${t}.recruitee.com/api/offers/`,
      parse: (data) => {
        const offers = (data as { offers?: unknown })?.offers;
        if (!Array.isArray(offers)) return [];
        return offers
          .map((o: Record<string, unknown>) => {
            const location = [str(o?.city), str(o?.country)].filter(Boolean).join(", ");
            const title = str(o?.title);
            return mkJob({
              title,
              department: str(o?.department),
              location: location || str(o?.location) || null,
              url: str(o?.careers_url) || str(o?.careers_apply_url) || null,
              postedAt: toIso(o?.published_at ?? o?.created_at),
              salary:
                o?.salary != null
                  ? normalizeSalary(o.salary)
                  : normalizeSalary([str(o?.min_salary), str(o?.max_salary), str(o?.currency)].join(" ")),
              seniority: normalizeSeniority(title, str(o?.experience_level) || str(o?.seniority)),
            });
          })
          .filter((j) => j.title);
      },
    },
  },
  {
    // Personio exposes a public XML job feed (no auth) at
    // {token}.jobs.personio.{com,de}/xml. It carries an explicit <seniority> and
    // <createdAt>, which the JSON ATS providers mostly don't.
    name: "personio",
    patterns: [/([a-z0-9][a-z0-9-]{1,49})\.jobs\.personio\.(?:com|de)/i],
    boardUrl: (t) => `https://${t}.jobs.personio.com/`,
    api: {
      url: (t) => `https://${t}.jobs.personio.com/xml?language=en`,
      format: "xml",
      parse: (data, token) => {
        if (typeof data !== "string") return [];
        const blocks = data.match(/<position>[\s\S]*?<\/position>/gi);
        if (!blocks) return [];
        return blocks
          .map((b) => {
            const title = xmlTag(b, "name");
            const id = xmlTag(b, "id");
            return mkJob({
              title,
              department: xmlTag(b, "department"),
              location: xmlTag(b, "office") || null,
              url: id ? `https://${token}.jobs.personio.com/job/${id}` : null,
              postedAt: toIso(xmlTag(b, "createdAt")),
              seniority: normalizeSeniority(title, xmlTag(b, "seniority")),
            });
          })
          .filter((j) => j.title);
      },
    },
  },
  {
    // Workable has no clean public board API → detected for the link-follow
    // fallback only (the worker LLM-extracts from the rendered board page).
    name: "workable",
    patterns: [
      /apply\.workable\.com\/(?:j\/)?([a-z0-9][a-z0-9_-]{1,49})/i,
      /([a-z0-9][a-z0-9_-]{1,49})\.workable\.com/i,
    ],
    boardUrl: (t) => `https://apply.workable.com/${t}/`,
  },
];

// Path/subdomain segments that are never a real board token.
const DENYLIST = new Set([
  "www", "embed", "job_board", "js", "api", "static", "assets", "widget",
  "v0", "v1", "postings", "jobs", "boards", "careers", "apply", "help",
  "support", "blog", "about", "help-center", "status",
]);

/** Detect the ATS board referenced by a careers page. Null when none is found. */
export function detectAtsBoard(html: string): AtsBoard | null {
  for (const def of PROVIDERS) {
    for (const re of def.patterns) {
      const m = re.exec(html);
      if (m && m[1]) {
        const token = m[1].toLowerCase();
        if (DENYLIST.has(token)) continue;
        return { provider: def.name, token, boardUrl: def.boardUrl(token) };
      }
    }
  }
  return null;
}

/**
 * Rebuild an AtsBoard from a persisted "provider:token" platform-profile key
 * (patch-31), so the jobs scraper can hit the API directly without re-detecting
 * from the careers HTML. Null when the provider is unknown or the key malformed.
 */
export function atsBoardFromKey(key: string): AtsBoard | null {
  const idx = key.indexOf(":");
  if (idx <= 0) return null;
  const provider = key.slice(0, idx).toLowerCase();
  const token = key.slice(idx + 1).toLowerCase();
  if (!token) return null;
  const def = PROVIDERS.find((p) => p.name === provider);
  if (!def) return null;
  return { provider, token, boardUrl: def.boardUrl(token) };
}

async function fetchJson(url: string, timeoutMs = 8000): Promise<unknown | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: {
        "user-agent": "Mozilla/5.0 (compatible; OutrivalBot/1.0; +https://outrival.io)",
        accept: "application/json",
      },
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchText(url: string, timeoutMs = 8000): Promise<string | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: {
        "user-agent": "Mozilla/5.0 (compatible; OutrivalBot/1.0; +https://outrival.io)",
        accept: "application/xml, text/xml, */*",
      },
    });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Fetch postings from the ATS public API. Returns null on any failure or when
 * the provider has no API mapping / the board is empty — the caller then falls
 * back to following the board link (fail-soft: never worse than today).
 */
export async function fetchAtsJobs(board: AtsBoard): Promise<AtsJob[] | null> {
  const def = PROVIDERS.find((p) => p.name === board.provider);
  if (!def?.api) return null;
  const data =
    def.api.format === "xml"
      ? await fetchText(def.api.url(board.token))
      : await fetchJson(def.api.url(board.token));
  if (data == null) return null;
  const jobs = def.api.parse(data, board.token);
  return jobs.length > 0 ? jobs : null;
}

/**
 * Parse an already-fetched ATS API response into normalized jobs. Exposed so the
 * per-provider mappers (incl. enrichment) can be unit-tested on fixtures without
 * hitting the network. `data` is the parsed JSON value, or the raw XML string for
 * xml-format providers (Personio).
 */
export function parseAtsResponse(provider: string, data: unknown, token = "acme"): AtsJob[] {
  const def = PROVIDERS.find((p) => p.name === provider);
  if (!def?.api) return [];
  return def.api.parse(data, token);
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Human salary range for the visible diff line, e.g. "USD 120,000–160,000". */
function salaryLabel(j: AtsJob): string {
  if (j.salaryMin == null && j.salaryMax == null) return "";
  const fmt = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 0 });
  const range =
    j.salaryMin != null && j.salaryMax != null
      ? `${fmt(j.salaryMin)}–${fmt(j.salaryMax)}`
      : fmt((j.salaryMin ?? j.salaryMax) as number);
  return [j.salaryCurrency, range].filter(Boolean).join(" ");
}

/**
 * Append the resolved postings to the careers page HTML: a VISIBLE list (so the
 * change-detection hash + diff move when the openings change) plus a JSON island
 * the worker parses for the structured, LLM-free job_postings update. Appending
 * (not replacing) keeps the snapshot's content size stable, so the anti-void
 * guard never trips on the careers-page→ATS transition.
 */
export function appendAtsJobsToHtml(careersHtml: string, board: AtsBoard, jobs: AtsJob[]): string {
  // Sort deterministically so a varying API order can't flip the snapshot hash
  // when the set of openings is unchanged (idempotence: no phantom change).
  const sorted = [...jobs].sort((a, b) =>
    `${a.title} ${a.department}`.localeCompare(`${b.title} ${b.department}`),
  );
  const items = sorted
    .map((j) => {
      const meta = [j.department, j.location, salaryLabel(j)]
        .filter((x): x is string => Boolean(x))
        .map(escapeHtml)
        .join(" · ");
      const label = meta ? `${escapeHtml(j.title)} — ${meta}` : escapeHtml(j.title);
      const link = j.url ? ` (${escapeHtml(j.url)})` : "";
      return `<li>${label}${link}</li>`;
    })
    .join("");
  // Escape every `<` so a posting field can't break out of the <script> island;
  // `<` is a valid JSON escape, so JSON.parse decodes it back transparently.
  const json = JSON.stringify({ provider: board.provider, token: board.token, jobs: sorted }).replace(
    /</g,
    "\\u003c",
  );
  const block =
    `<section data-outrival-ats="${escapeHtml(board.provider)}"><h2>Open roles</h2><ul>${items}</ul></section>` +
    `<script type="application/json" id="${ATS_JOBS_MARKER}">${json}</script>`;
  const idx = careersHtml.lastIndexOf("</body>");
  return idx === -1 ? careersHtml + block : careersHtml.slice(0, idx) + block + careersHtml.slice(idx);
}

function coerceNum(x: unknown): number | null {
  return typeof x === "number" && Number.isFinite(x) ? x : null;
}

function coerceJob(x: unknown): AtsJob | null {
  if (!x || typeof x !== "object") return null;
  const o = x as Record<string, unknown>;
  const title = str(o.title);
  if (!title) return null;
  const seniority = str(o.seniority);
  return {
    title,
    department: str(o.department) || "Other",
    location: str(o.location) || null,
    url: str(o.url) || null,
    seniority: (SENIORITY_LEVELS as readonly string[]).includes(seniority)
      ? (seniority as Seniority)
      : null,
    postedAt: str(o.postedAt) || null,
    salaryMin: coerceNum(o.salaryMin),
    salaryMax: coerceNum(o.salaryMax),
    salaryCurrency: str(o.salaryCurrency) || null,
  };
}

/**
 * Parse the postings the scraper embedded as a JSON island in the snapshot HTML.
 * Returns null when there is no island (the snapshot is a plain careers/board
 * page → the worker LLM-extracts instead).
 */
export function parseAtsJobsFromHtml(html: string): AtsJob[] | null {
  const re = new RegExp(
    `<script[^>]*id=["']${ATS_JOBS_MARKER}["'][^>]*>([\\s\\S]*?)<\\/script>`,
    "i",
  );
  const m = re.exec(html);
  if (!m || !m[1]) return null;
  try {
    const data = JSON.parse(m[1]) as { jobs?: unknown };
    if (!Array.isArray(data.jobs)) return null;
    const out: AtsJob[] = [];
    for (const j of data.jobs) {
      const job = coerceJob(j);
      if (job) out.push(job);
    }
    return out;
  } catch {
    return null;
  }
}
