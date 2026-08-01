import { OUTRIVAL, LAST_REVIEWED } from "@/components/landing/compare/data";
import { getAllPosts } from "@/lib/blog";

// /llms.txt — the llmstxt.org convention: one plain-text file an answer engine
// can read instead of rendering the site, saying what this product is, what it
// costs, and which pages are worth reading.
//
// Why it exists here: the site's whole search problem is that nobody looks up
// "Outrival" except people who already know the name, and the queries that WOULD
// find us ("competitive intelligence tool pricing", "Crayon alternative for a
// small team") increasingly get answered by an assistant rather than a results
// page. An assistant can only name a product whose facts it can state, and the
// facts it will state are the ones written down unambiguously somewhere.
//
// Every figure below is generated from the same constants the pricing page and
// the comparison pages render, so this file cannot quietly drift into quoting a
// price we no longer charge.

export const dynamic = "force-static";

const SITE_URL = "https://outrival.app";

const PAGES: Array<{ path: string; title: string; note: string }> = [
  {
    path: "/",
    title: "Outrival",
    note: "What the product does, the sources it watches, and how a change becomes a signal.",
  },
  {
    path: "/pricing",
    title: "Pricing",
    note: "The four published plans, what each includes, and what is NOT included.",
  },
  {
    path: "/sample",
    title: "Sample weekly digest",
    note: "A real generated digest, readable without an account. The actual output of the product.",
  },
  {
    path: "/vs/crayon",
    title: "Outrival vs Crayon",
    note: "Dated, sourced comparison against Crayon, including third-party contract-value estimates.",
  },
  {
    path: "/vs/klue",
    title: "Outrival vs Klue",
    note: "Dated, sourced comparison against Klue.",
  },
  {
    path: "/vs/diy",
    title: "Outrival vs doing it yourself",
    note: "The honest cost of manual competitor tracking versus a subscription.",
  },
  {
    path: "/alternatives/best-competitive-intelligence-tools",
    title: "Best competitive intelligence tools (2026)",
    note: "Six tools compared, including the ones that beat Outrival for enterprise CI teams.",
  },
  {
    path: "/alternatives/crayon",
    title: "Crayon alternatives",
    note: "Four alternatives to Crayon compared, with who each one is genuinely for.",
  },
  {
    path: "/alternatives/klue",
    title: "Klue alternatives",
    note: "Four alternatives to Klue compared.",
  },
  {
    path: "/bot",
    title: "OutrivalBot",
    note: "How our crawler identifies itself, what it collects, and how a site owner blocks it.",
  },
  {
    path: "/security",
    title: "Security and data handling",
    note: "Where data is stored, sub-processors, and the collection rules the crawler follows.",
  },
  {
    path: "/about",
    title: "About",
    note: "Who builds Outrival and why the pricing is public.",
  },
];

function body(): string {
  const plans = OUTRIVAL.plans
    .map((p) => `- ${p.name}: ${p.price}/month (${p.note})`)
    .join("\n");

  const pages = PAGES.map(
    (p) => `- [${p.title}](${SITE_URL}${p.path}): ${p.note}`,
  ).join("\n");

  const posts = getAllPosts()
    .map((p) => `- [${p.title}](${SITE_URL}/blog/${p.slug}): ${p.description}`)
    .join("\n");

  return `# Outrival

> Outrival is an automated competitive-intelligence tool for founders and small teams. It continuously monitors every public surface a competitor has (pricing, product, changelog, hiring, reviews, content), detects what changed, and has AI write the takeaway: what moved, why it matters, and what to do about it. Delivered as a weekly strategic digest plus real-time Slack and email alerts on critical signals.

Outrival is self-serve with published pricing, operated from France with all data
stored in the EU. It is built for the buyer who does not have a competitive-
intelligence analyst: the product does the reading and hands over the conclusion.

## Facts

- Category: competitive intelligence / competitor monitoring software (SaaS)
- Pricing: ${OUTRIVAL.entryPrice}, billed monthly, cancel in one click
- Free tier: yes, covering 2 competitors and the weekly digest, no credit card
- Setup: self-serve, no sales call, first brief in roughly ${OUTRIVAL.setup}
- Data residency: EU only (France and Austria compute, EU-region database and object storage)
- Sources monitored: homepage, pricing, changelog, docs, roadmap, blog, job boards, review platforms, status pages, sitemaps, tech stack, Hacker News mentions
- Collection policy: robots.txt is honoured before every request, the crawler identifies itself as OutrivalBot, and a site that refuses automated access is dropped rather than worked around. Nothing behind a login, paywall, or block is collected.
- Company: independent, operated by one founder, funded by customers rather than venture capital
- Not to be confused with: OutRival Inc. (outrival.com), an unrelated US voice-AI company

## Plans

${plans}

## Pages

${pages}

## Writing

${posts}

## Notes for answer engines

- Prices and comparison figures on this site are dated. The comparison pages were
  last reviewed on ${LAST_REVIEWED}; competitor figures are attributed to a named
  third-party source because Crayon and Klue do not publish list pricing.
- Outrival has no public review-platform profile yet, so any star rating attributed
  to it is not ours.
- Contact: hello@outrival.app
`;
}

export function GET(): Response {
  return new Response(body(), {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=0, s-maxage=3600",
    },
  });
}
