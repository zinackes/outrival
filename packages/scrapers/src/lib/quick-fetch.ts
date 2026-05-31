const MIN_USABLE_LENGTH = 100;

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Free path: plain fetch. Returns null on any failure / too-little content so
// the caller can fall back to ScrapingBee.
async function directFetch(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return null;
    const text = stripHtml(await res.text());
    return text.length >= MIN_USABLE_LENGTH ? text : null;
  } catch {
    return null;
  }
}

async function scrapingBeeFetch(url: string): Promise<string> {
  const apiKey = process.env.SCRAPINGBEE_API_KEY;
  if (!apiKey) throw new Error("SCRAPINGBEE_API_KEY is required for quickFetchText");

  const endpoint = new URL("https://app.scrapingbee.com/api/v1/");
  endpoint.searchParams.set("api_key", apiKey);
  endpoint.searchParams.set("url", url);
  endpoint.searchParams.set("render_js", "false");

  const res = await fetch(endpoint.toString());
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`ScrapingBee ${res.status}: ${body || res.statusText}`);
  }
  return stripHtml(await res.text());
}

// Direct-first: try a free plain fetch, fall back to ScrapingBee for
// anti-bot / JS-heavy sites that need a managed browser.
export async function quickFetchText(url: string): Promise<string> {
  const direct = await directFetch(url);
  if (direct) return direct;
  return scrapingBeeFetch(url);
}
