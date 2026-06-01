import { adminFetch } from "../_lib/server";
import { JobsView } from "./view";
import type { AdminJobRun } from "@/lib/api";

export default async function JobsPage() {
  const data = await adminFetch<{
    runs: AdminJobRun[];
    nextCursor: string | null;
    error?: string;
  }>("/api/admin/jobs");
  return (
    <JobsView
      initialRuns={data?.runs ?? []}
      initialCursor={data?.nextCursor ?? null}
      unavailable={!data || !!data.error}
    />
  );
}
