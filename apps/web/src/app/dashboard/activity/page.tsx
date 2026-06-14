import { ActivityView } from "@/components/dashboard/activity-view";
import { getActivityData } from "@/lib/api-server";

export default async function ActivityPage() {
  // Best-effort server prefetch of health + the default timeline page; null
  // falls back to the client fetches inside ActivityView.
  const initialData = await getActivityData();
  return <ActivityView initialData={initialData} />;
}
