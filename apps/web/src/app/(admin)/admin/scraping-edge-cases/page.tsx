import { adminFetch } from "../_lib/server";
import { EdgeCasesView } from "./view";
import type { AdminEdgeCases } from "@/lib/api";

export default async function ScrapingEdgeCasesPage() {
  const data = await adminFetch<AdminEdgeCases>("/api/admin/scraping-edge-cases");
  return <EdgeCasesView data={data} />;
}
