import { z } from "zod";
import { complete } from "../provider";
import { AI_CONFIG } from "../config";
import { safeParseJson } from "../lib/parse";

/**
 * Read a BATCH of a competitor's blog posts (Content Intelligence v2 P2).
 *
 * The blog is the source a competitor publishes to most often and the one we
 * understood least: a post announcing a launch, a teardown of a rival and an SEO
 * filler page all reached the pipeline as the same three added lines on an index
 * page. This says what each post IS, what it is about, and — the part that earns
 * its cost — which competitors it names.
 *
 * Everything it returns is a PROPOSAL. `applyBlogGuards`
 * (@outrival/scrapers/content) decides what survives: a named competitor is kept
 * only when the post writes that name and the quoted sentence is genuinely in the
 * text. That check is in code because the alert it gates is `critical`, and a
 * guard living in a prompt is a request rather than a check.
 *
 * Batched at ~10 posts per call: posts are independent, so a run of twenty costs
 * two calls rather than twenty.
 */

export const BLOG_POST_TYPES = [
  "feature_announcement",
  "case_study",
  "thought_leadership",
  "seo",
  "tutorial",
  "company_news",
] as const;

export const BlogMentionSchema = z.object({
  /** The competitor's name AS THE POST WRITES IT — never normalised or expanded. */
  name: z.string(),
  /** The sentence naming them, copied word for word. Substring-checked by the caller. */
  snippet: z.string().nullable().optional(),
});

export const EnrichedBlogPostSchema = z.object({
  /** Index into the batch passed in — row ids are never sent, so none can be mangled. */
  index: z.number().int(),
  item_type: z.enum(BLOG_POST_TYPES),
  /** 2-5 lowercase subject tags. */
  topics: z.array(z.string()).default([]),
  /** Their own products/features the post is about. */
  products: z.array(z.string()).default([]),
  /** Who the post is written for ("engineering managers", "RevOps"). */
  personas: z.array(z.string()).default([]),
  competitors_named: z.array(BlogMentionSchema).default([]),
  /** One or two sentences, English, about what the post says. */
  summary: z.string(),
});

export const EnrichedBlogPostsSchema = z.object({
  posts: z.array(EnrichedBlogPostSchema),
});

export type EnrichedBlogPost = z.infer<typeof EnrichedBlogPostSchema>;
export type EnrichedBlogPosts = z.infer<typeof EnrichedBlogPostsSchema>;

export interface BlogPostForEnrichment {
  title: string;
  /** The fetched article text, chrome stripped. */
  text: string;
}

/** How much of one post the model sees. A long-form post fits inside this. */
const MAX_POST_CHARS = 6000;

export async function enrichBlogPosts(
  batch: ReadonlyArray<BlogPostForEnrichment>,
): Promise<EnrichedBlogPosts | null> {
  if (batch.length === 0) return { posts: [] };

  const docs = batch
    .map(
      (p, i) =>
        `<post index="${i}">\n<title>${p.title}</title>\n<body>\n${p.text.slice(
          0,
          MAX_POST_CHARS,
        )}\n</body>\n</post>`,
    )
    .join("\n\n");

  const prompt = `<blog_posts>
${docs}
</blog_posts>

<task>
You are reading posts from a software company's blog. For each post, say what kind
of post it is, what it is about, and which other companies it names.

Kinds:
- "feature_announcement": announces something their product can now do.
- "case_study": tells one named customer's story, usually with results.
- "thought_leadership": an opinion or point of view about their market.
- "tutorial": teaches the reader how to do something.
- "seo": a generic explainer written to rank in search, not tied to their product.
- "company_news": funding, hiring, an event, an acquisition, a milestone.

RULES — these decide whether your answer is usable:
- Return one entry per index given, and no index that was not given.
- "topics" is 2 to 5 lowercase subject tags ("api security", "onboarding").
- "products" names THEIR OWN products or features the post is about. Empty if none.
- "personas" is who the post is written for. Empty if it does not address anyone.
- "competitors_named" lists OTHER companies the post names. For each one, "snippet"
  MUST be copied WORD FOR WORD from the post body — the sentence that names them.
  Do not paraphrase it, do not translate it, do not join two sentences.
- List a company ONLY if the post writes its name. Do not infer a company from
  "the incumbents", "legacy tools" or "the usual alternatives" — return nothing
  there. A name that is not in the text is discarded.
- Do not list the company whose blog this is among "competitors_named".
- "summary" is one or two sentences, at most 35 words, written in English even when
  the post is not, about what the post says — never about how important it is.

Reply ONLY with a valid JSON object, no markdown and no surrounding text.
</task>

<format>
{
  "posts": [
    {
      "index": 0,
      "item_type": "case_study",
      "topics": ["migration", "data warehouse"],
      "products": ["Sync Engine"],
      "personas": ["data engineers"],
      "competitors_named": [
        { "name": "Fivetran", "snippet": "The team moved off Fivetran after two years." }
      ],
      "summary": "How one customer migrated their pipelines and cut sync latency."
    }
  ]
}
</format>`;

  const raw = await complete(AI_CONFIG.classification, { prompt, json: true, maxTokens: 4096 });
  const result = safeParseJson(raw, EnrichedBlogPostsSchema);
  if (!result.ok) {
    console.error("Blog post enrichment parse failed:", result.error, "raw:", raw.slice(0, 500));
    return null;
  }
  return result.value;
}
