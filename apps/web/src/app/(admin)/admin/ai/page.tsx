import { adminFetch } from "../_lib/server";
import { AiView } from "./view";
import type { AdminAiHealth } from "@/lib/api";

export default async function AiPage() {
  const data = await adminFetch<AdminAiHealth>("/api/admin/ai-health");
  return <AiView data={data} />;
}
