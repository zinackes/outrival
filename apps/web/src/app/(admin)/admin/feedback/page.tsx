import { adminFetch } from "../_lib/server";
import { FeedbackView } from "./view";
import type { AdminFeedbackRow } from "@/lib/api";

export default async function FeedbackPage() {
  const data = await adminFetch<{ feedback: AdminFeedbackRow[] }>("/api/admin/feedback");
  return <FeedbackView initial={data?.feedback ?? []} />;
}
