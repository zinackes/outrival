import { toast } from "sonner";
import { api } from "@/lib/api";

// Shared admin action — used by the scraping view and the user-detail view.
// Imported only by client components.
export async function forceScrape(monitorId: string): Promise<void> {
  try {
    await api.adminForceScrape(monitorId);
  } catch {
    toast.error("Could not trigger scrape");
  }
}
