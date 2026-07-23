import { z } from "zod";
import { normalizeDomain } from "@outrival/shared";
import { AI_CONFIG } from "../config";
import { groundedAiCall } from "../grounding/grounded-call";
import type { ProductProfile } from "./analyze-product";

const CACHE_TTL_SECONDS = Number(process.env.AI_CACHE_TTL_NAME_DAYS ?? 7) * 86400;

const NamedSchema = z.object({
  competitors: z.array(
    z.object({
      name: z.string(),
      domain: z.string(),
      why: z.string(),
    }),
  ),
});

export interface NamedCompetitor {
  name: string;
  domain: string;
  why: string;
}

// A bare registrable domain (what the prompt asks for). Anything else — a path, a
// sentence, a made-up TLD — is dropped rather than turned into a monitor that 404s.
const DOMAIN_RE = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/;

/**
 * Names the competitors a model already knows for a product, as domains.
 *
 * Exa's semantic search answers "which company page reads like this description?",
 * which surfaces obscure long-tail companies and misses the market leaders whose
 * pages don't paraphrase the query (a Vercel-shaped profile returned neither
 * Cloudflare Pages nor Render). A model asked directly names them in one fast call.
 * It is a RECALL source only: every domain still goes through the discovery
 * filters, the liveness check (which kills invented domains) and the overlap
 * score, so a hallucinated or off-market name costs nothing but a row in the pool.
 *
 * Best-effort — returns [] on a parse miss / provider failure, never throws.
 */
export async function nameKnownCompetitors(
  profile: ProductProfile,
  productUrl?: string | null,
  limit = 12,
): Promise<NamedCompetitor[]> {
  const prompt = `<product>
${productUrl ? `Site: ${productUrl}\n` : ""}Category: ${profile.category}
Audience: ${profile.audience}
What it does: ${profile.whatItDoes?.trim() || profile.valueProp}
Value: ${profile.valueProp}
Keywords: ${(profile.keywords ?? []).join(", ")}
</product>

<task>
List up to ${limit} REAL, currently-operating companies that compete with this product.
Only companies you are confident exist, each with its official primary domain
(registrable domain only — no scheme, no "www.", no path).
Never list the product itself, directories, review sites, marketplaces, app stores
or social networks. Order by how directly they compete. If you don't know this
market, return an empty list rather than guessing.
Reply ONLY with a valid JSON object, no markdown and no surrounding text.
Write all text values in English.
</task>

<format>
{ "competitors": [ { "name": "...", "domain": "example.com", "why": "one sentence" } ] }
</format>`;

  const cacheInput = JSON.stringify({ profile, productUrl: productUrl ?? null, limit });

  const result = await groundedAiCall({
    taskName: "name_competitors",
    config: AI_CONFIG.classification,
    prompt,
    sourceText: cacheInput,
    schema: NamedSchema,
    maxTokens: 1500,
    cache: { input: cacheInput, namespace: "name-competitors", ttlSeconds: CACHE_TTL_SECONDS },
  });

  if (!result) return [];

  const ownDomain = normalizeDomain(productUrl);
  const seen = new Set<string>();
  const out: NamedCompetitor[] = [];
  for (const c of result.output.competitors) {
    const domain = normalizeDomain(c.domain) ?? normalizeDomain(`https://${c.domain}`);
    if (!domain || !DOMAIN_RE.test(domain)) continue;
    if (ownDomain && domain === ownDomain) continue;
    if (seen.has(domain)) continue;
    seen.add(domain);
    out.push({ name: c.name, domain, why: c.why });
    if (out.length >= limit) break;
  }
  return out;
}
