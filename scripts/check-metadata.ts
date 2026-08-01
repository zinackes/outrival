// Head-tag audit for the public site.
//
// Every public page must carry its own title, meta description, canonical,
// og:url equal to that canonical, and a social image. Getting this wrong is
// invisible in the app and only shows up the day someone shares a link — which
// is exactly when it costs the most.
//
//   bun scripts/check-metadata.ts                       # against production
//   bun scripts/check-metadata.ts http://localhost:3000  # against a local build
//
// Exits non-zero when a page fails, so it can gate a deploy.

const BASE = (process.argv[2] ?? "https://outrival.app").replace(/\/$/, "");

// The public routes. Blog posts are discovered from /blog rather than listed,
// so a new article can never silently skip the check.
const ROUTES = [
  "/",
  "/pricing",
  "/sample",
  "/about",
  "/demo",
  "/docs",
  "/status",
  "/changelog",
  "/blog",
  "/vs/crayon",
  "/vs/klue",
  "/vs/diy",
  "/alternatives/crayon",
  "/alternatives/klue",
  "/alternatives/best-competitive-intelligence-tools",
  "/security",
  "/bot",
  "/legal",
  "/legal-notice",
  "/subprocessors",
  "/privacy",
  "/cookies",
  "/terms",
  "/terms-of-sale",
  "/acceptable-use",
  "/accessibility",
  "/dpa",
];

type Head = {
  title: string | null;
  description: string | null;
  canonical: string | null;
  ogUrl: string | null;
  ogTitle: string | null;
  ogDescription: string | null;
  ogImage: string | null;
  twitterTitle: string | null;
  twitterDescription: string | null;
  twitterImage: string | null;
  keywords: string | null;
};

function attr(html: string, re: RegExp): string | null {
  const m = html.match(re);
  return m?.[1]?.trim() ?? null;
}

function parseHead(html: string): Head {
  const meta = (name: string) =>
    attr(
      html,
      new RegExp(
        `<meta[^>]+(?:name|property)=["']${name}["'][^>]+content=["']([^"']*)["']`,
        "i"
      )
    ) ??
    attr(
      html,
      new RegExp(
        `<meta[^>]+content=["']([^"']*)["'][^>]+(?:name|property)=["']${name}["']`,
        "i"
      )
    );

  return {
    title: attr(html, /<title[^>]*>([^<]*)<\/title>/i),
    description: meta("description"),
    canonical: attr(html, /<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']*)["']/i),
    ogUrl: meta("og:url"),
    ogTitle: meta("og:title"),
    ogDescription: meta("og:description"),
    ogImage: meta("og:image"),
    twitterTitle: meta("twitter:title"),
    twitterDescription: meta("twitter:description"),
    twitterImage: meta("twitter:image"),
    keywords: meta("keywords"),
  };
}

const norm = (u: string | null) => (u ? u.replace(/\/$/, "") : null);

// Canonicals and og:url resolve against metadataBase, so they always carry the
// production origin — even when this runs against a local build. Compare paths.
const path = (u: string | null) => {
  if (!u) return null;
  try {
    return new URL(u, "https://outrival.app").pathname.replace(/\/$/, "") || "/";
  } catch {
    return u;
  }
};

async function main() {
  // Discover blog posts so new articles are covered automatically.
  const routes = [...ROUTES];
  try {
    const blog = await fetch(`${BASE}/blog`).then((r) => r.text());
    for (const m of blog.matchAll(/href=["'](\/blog\/[a-z0-9-]+)["']/gi)) {
      const path = m[1];
      if (path && !routes.includes(path)) routes.push(path);
    }
  } catch {
    console.warn("! could not read /blog to discover posts");
  }

  const seenTitle = new Map<string, string>();
  const seenCanonical = new Map<string, string>();
  let failures = 0;

  for (const route of routes) {
    const url = `${BASE}${route}`;
    let html: string;
    try {
      const res = await fetch(url, { redirect: "follow" });
      if (!res.ok) {
        console.log(`FAIL ${route} — HTTP ${res.status}`);
        failures++;
        continue;
      }
      html = await res.text();
    } catch (err) {
      console.log(`FAIL ${route} — ${String(err).slice(0, 80)}`);
      failures++;
      continue;
    }

    const h = parseHead(html);
    const problems: string[] = [];

    if (!h.title) problems.push("no <title>");
    if (!h.description) problems.push("no meta description");
    if (!h.canonical) problems.push("no canonical");
    if (!h.ogImage) problems.push("no og:image");
    if (!h.twitterImage) problems.push("no twitter:image");

    // The bug this script exists for: og:url left pointing at the homepage.
    if (h.canonical && h.ogUrl && path(h.canonical) !== path(h.ogUrl)) {
      problems.push(`og:url ${h.ogUrl} != canonical ${h.canonical}`);
    }
    if (h.canonical && path(h.canonical) !== (norm(route) || "/")) {
      problems.push(`canonical ${h.canonical} != ${route}`);
    }

    // Social cards that quietly inherit the homepage's copy.
    if (h.title && h.ogTitle && h.ogTitle === seenTitle.get("/") && route !== "/") {
      problems.push("og:title inherited from home");
    }
    if (
      route !== "/" &&
      h.twitterTitle &&
      h.twitterTitle === (seenTitle.get("twitter:/") ?? null)
    ) {
      problems.push("twitter:title inherited from home");
    }

    if (h.title) {
      const prev = seenTitle.get(h.title);
      if (prev) problems.push(`duplicate <title> with ${prev}`);
      else seenTitle.set(h.title, route);
    }
    if (h.canonical) {
      const prev = seenCanonical.get(norm(h.canonical)!);
      if (prev) problems.push(`duplicate canonical with ${prev}`);
      else seenCanonical.set(norm(h.canonical)!, route);
    }
    if (h.keywords) problems.push("meta keywords present (drop it)");

    if (route === "/") {
      seenTitle.set("/", h.ogTitle ?? "");
      seenTitle.set("twitter:/", h.twitterTitle ?? "");
    }

    if (problems.length) {
      failures++;
      console.log(`FAIL ${route}`);
      for (const p of problems) console.log(`       ${p}`);
    } else {
      console.log(`ok   ${route}`);
    }
  }

  console.log(`\n${routes.length} routes checked, ${failures} failing`);
  process.exit(failures ? 1 : 0);
}

await main();
