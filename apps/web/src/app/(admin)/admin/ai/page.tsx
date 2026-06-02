import { adminFetch } from "../_lib/server";
import { AiView } from "./view";
import { AiQualitySection, type AiQualityMetrics } from "./quality-section";
import type { AdminAiHealth } from "@/lib/api";

export default async function AiPage() {
  const [data, quality] = await Promise.all([
    adminFetch<AdminAiHealth>("/api/admin/ai-health"),
    adminFetch<AiQualityMetrics>("/api/admin/ai-quality-metrics"),
  ]);
  return (
    <div className="flex flex-col gap-5">
      <AiView data={data} />
      <AiQualitySection metrics={quality} />
    </div>
  );
}
