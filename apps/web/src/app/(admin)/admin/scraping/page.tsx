import { adminFetch } from "../_lib/server";
import { ScrapingView } from "./view";
import type { AdminScrapingHealth } from "@/lib/api";

export default async function ScrapingPage() {
  const data = await adminFetch<AdminScrapingHealth>("/api/admin/scraping-health");
  return <ScrapingView data={data} />;
}
