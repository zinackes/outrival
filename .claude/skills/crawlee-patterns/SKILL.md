---
name: crawlee-patterns
description: >
  Utiliser quand on crée ou modifie un scraper Outrival.
  Contient les patterns Crawlee complets avec anti-bot, R2 upload,
  et gestion des erreurs spécifiques au projet.
allowed-tools: [Read, Write, Edit, Bash]
---

# Crawlee Patterns — Outrival

## Pattern scraper complet

```typescript
// packages/scrapers/src/[source]/[source].scraper.ts
import { PlaywrightCrawler } from "crawlee";
import { uploadToR2 } from "@outrival/shared/r2";

export interface ScraperResult {
  html: string;
  text: string;
  screenshotBuffer: Buffer;
  metadata: Record;
}

export async function scrape(
  competitorId: string,
  url: string,
  useProxy = true
): Promise {
  let result: ScraperResult | null = null;

  const crawler = new PlaywrightCrawler({
    maxRequestRetries: 3,
    maxConcurrency: 1,
    requestHandlerTimeoutSecs: 30,
    ...(useProxy && {
      proxyConfiguration: await ProxyConfiguration.fromUrl(
        `https://app.scrapingbee.com/api/v1/?api_key=${process.env.SCRAPINGBEE_API_KEY}&render_js=true&url=`
      ),
    }),
    async requestHandler({ page, request }) {
      await page.waitForLoadState("networkidle");

      const html = await page.content();
      const text = await page.evaluate(() => document.body.innerText);
      const screenshotBuffer = await page.screenshot({ fullPage: true });

      result = { html, text, screenshotBuffer: Buffer.from(screenshotBuffer), metadata: {} };
    },
  });

  await crawler.run([url]);

  if (!result) throw new Error(`Scraping failed for ${url}`);
  return result;
}
```

## Upload R2 — pattern obligatoire

```typescript
// TOUJOURS upload R2 AVANT d'écrire en DB
const timestamp = new Date().toISOString();
const r2Key = `snapshots/${competitorId}/${sourceType}/${timestamp}`;

await uploadToR2(`${r2Key}.html`, result.html, "text/html");
await uploadToR2(`${r2Key}.png`, result.screenshotBuffer, "image/png");

// SEULEMENT APRÈS → écrire en DB
await db.insert(snapshots).values({
  monitorId,
  r2Key,
  contentHash: computeHash(result.html),
  scrapedAt: new Date(),
  status: "success",
});
```

## CheerioCrawler (sites statiques)

Utiliser pour : blogs, changelogs, pages sans JavaScript critique

```typescript
import { CheerioCrawler } from "crawlee";

const crawler = new CheerioCrawler({
  maxRequestRetries: 3,
  async requestHandler({ $, request }) {
    const text = $("body").text();
    const html = $.html();
    // Pas de screenshot avec Cheerio — prendre note dans metadata
  },
});
```

## Détection de changement

```typescript
import { createHash } from "crypto";

export function computeHash(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

// Si hash identique → pas de nouveau snapshot, pas de change
const lastSnapshot = await db.query.snapshots.findFirst({
  where: eq(snapshots.monitorId, monitorId),
  orderBy: desc(snapshots.scrapedAt),
});

if (lastSnapshot?.contentHash === computeHash(result.html)) {
  return { changed: false };
}
```

## Erreurs à gérer

- Timeout → laisser Crawlee retry (maxRequestRetries: 3)
- 403/bot detection → activer ScrapingBee (useProxy: true)
- Page vide → vérifier waitForLoadState, augmenter timeout
- Upload R2 fail → ne PAS écrire en DB, throw error pour trigger retry