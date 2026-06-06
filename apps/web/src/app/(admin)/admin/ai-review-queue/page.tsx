import { adminFetch } from "../_lib/server";
import { PageHeader, Section, Stat, Empty } from "../_components/shell";
import { ReviewQueueView, type ReviewItem } from "./view";

interface QueueStats {
  total: number;
  selfChecked: number;
  failed: number;
  confirmed: number;
  falsePositive: number;
  pending: number;
}

interface QueueResponse {
  items: ReviewItem[];
  stats: QueueStats;
}

function pct(part: number, whole: number): string {
  if (whole <= 0) return "—";
  return `${Math.round((part / whole) * 100)}%`;
}

export default async function AiReviewQueuePage() {
  const data = await adminFetch<QueueResponse>(`/api/admin/ai-review-queue`);
  const stats = data?.stats;
  const items = data?.items ?? [];

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="AI review queue"
        subtitle="Outputs that failed their self-check. Resolve each as a confirmed hallucination or a false positive — the content stays live for the user either way."
      />

      <Section
        title="Last 30 days"
        info="AI generation quality over 30 days: how many outputs ran a self-check, how many failed it, and how flagged items were triaged (confirmed hallucination / false positive / pending)."
      >
        {!stats ? (
          <Empty>No quality data yet.</Empty>
        ) : (
          <div className="grid grid-cols-2 gap-6 md:grid-cols-3">
            <Stat label="AI generations" value={stats.total} />
            <Stat
              label="Self-checked"
              value={stats.selfChecked}
              hint={`${pct(stats.selfChecked, stats.total)} of generations`}
            />
            <Stat
              label="Failed self-check"
              value={stats.failed}
              hint={`${pct(stats.failed, stats.selfChecked)} of checks`}
            />
            <Stat label="Hallucinations confirmed" value={stats.confirmed} />
            <Stat label="False positives" value={stats.falsePositive} />
            <Stat label="Pending review" value={stats.pending} />
          </div>
        )}
      </Section>

      <Section
        title="To review"
        note={`${items.length} flagged`}
        info="AI outputs that failed their self-check and await triage. Mark each as a confirmed hallucination or a false positive — the content stays live for the user either way."
      >
        <ReviewQueueView items={items} />
      </Section>
    </div>
  );
}
