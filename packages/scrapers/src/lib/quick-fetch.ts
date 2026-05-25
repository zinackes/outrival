export async function quickFetchText(url: string): Promise<string> {
  const apiKey = process.env.SCRAPINGBEE_API_KEY;
  if (!apiKey) throw new Error("SCRAPINGBEE_API_KEY is required for quickFetchText");

  const endpoint = new URL("https://app.scrapingbee.com/api/v1/");
  endpoint.searchParams.set("api_key", apiKey);
  endpoint.searchParams.set("url", url);
  endpoint.searchParams.set("render_js", "false");

  const res = await fetch(endpoint.toString());
  if (!res.ok) throw new Error(`quickFetchText failed: ${res.status} ${res.statusText}`);
  const html = await res.text();

  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
