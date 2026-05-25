import Exa from "exa-js";

let exaClient: Exa | null = null;

function getExa(): Exa {
  if (!exaClient) {
    const key = process.env.EXA_API_KEY;
    if (!key) throw new Error("EXA_API_KEY is required for discovery");
    exaClient = new Exa(key);
  }
  return exaClient;
}

export interface DiscoveredCompany {
  url: string;
  title: string;
  snippet: string;
}

export async function findSimilarCompanies(
  productUrl: string,
  count = 15,
): Promise<DiscoveredCompany[]> {
  const hostname = new URL(productUrl).hostname;

  const results = await getExa().findSimilarAndContents(productUrl, {
    numResults: count,
    excludeDomains: [hostname],
    text: { maxCharacters: 500 },
  });

  return results.results.map((r) => ({
    url: r.url,
    title: r.title ?? new URL(r.url).hostname,
    snippet: r.text ?? "",
  }));
}
