#!/usr/bin/env node
// Submit every public URL to IndexNow.
//
// Why this exists: Google does not support IndexNow and never adopted it, so
// this is not a Google play. Bing, Yandex, Seznam and Naver do — and Bing's
// index is the retrieval layer behind ChatGPT Search and Microsoft Copilot. A
// page missing from Bing is a page those two answer engines cannot cite, and
// waiting for an organic Bing crawl on a domain with no authority is measured in
// weeks. One HTTP POST replaces the wait.
//
// The key is PUBLIC by design: the protocol verifies ownership by having you
// serve the key back from your own host, which is why it is committed to
// `public/` rather than kept in an env var. Rotating it means replacing both the
// file and the constant below.
//
// Usage:  node scripts/indexnow.mjs            (submits everything in the sitemap)
//         node scripts/indexnow.mjs /pricing /blog/new-post
//
// Run it after a deploy that adds or materially changes a public page. Running
// it on every deploy is fine; re-submitting an unchanged URL is a no-op for the
// engines, not a penalty.

const HOST = "outrival.app";
const KEY = "9d965d83dffb68704094ad333c60a966";
const KEY_LOCATION = `https://${HOST}/${KEY}.txt`;
const ENDPOINT = "https://api.indexnow.org/IndexNow";

async function urlsFromSitemap() {
  const res = await fetch(`https://${HOST}/sitemap.xml`);
  if (!res.ok) {
    throw new Error(`sitemap.xml returned ${res.status}`);
  }
  const xml = await res.text();
  return [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
}

async function main() {
  const args = process.argv.slice(2);
  const urlList = args.length
    ? args.map((p) => (p.startsWith("http") ? p : `https://${HOST}${p}`))
    : await urlsFromSitemap();

  if (urlList.length === 0) {
    console.error("No URLs to submit.");
    process.exit(1);
  }

  // The key file must be reachable before the submission, or every URL is
  // rejected as unverified — and the API answers 200 either way, so this is
  // checked here rather than guessed at from the response.
  const keyCheck = await fetch(KEY_LOCATION);
  const keyBody = keyCheck.ok ? (await keyCheck.text()).trim() : "";
  if (keyBody !== KEY) {
    console.error(
      `Key file ${KEY_LOCATION} is not serving the key (status ${keyCheck.status}).\n` +
        `Deploy apps/web/public/${KEY}.txt first — submissions before that are silently discarded.`,
    );
    process.exit(1);
  }

  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify({
      host: HOST,
      key: KEY,
      keyLocation: KEY_LOCATION,
      urlList,
    }),
  });

  // 200 accepted · 202 accepted, key validation pending · 400 bad request
  // 403 key not valid · 422 URLs not under the host · 429 too many requests
  console.log(`IndexNow ${res.status} — ${urlList.length} URLs submitted`);
  if (!res.ok) {
    console.error(await res.text());
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
