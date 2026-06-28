import { adminFetch } from "../_lib/server";
import { PageHeader, Section, Stat, Empty, pctFmt } from "../_components/shell";
import type { AdminEnrichmentCompleteness } from "@/lib/api";

export default async function EnrichmentCompletenessPage() {
  const m = await adminFetch<AdminEnrichmentCompleteness>(
    "/api/admin/enrichment-completeness",
  );

  if (!m) {
    return (
      <div className="flex flex-col gap-5">
        <PageHeader title="Enrichment" subtitle="How much structured enrichment actually lands." />
        <Section title="Enrichment">
          <Empty>Metrics unavailable.</Empty>
        </Section>
      </div>
    );
  }

  // value + share, or just the count when the denominator is 0.
  const val = (num: number, den: number) =>
    `${num}${den > 0 ? ` · ${pctFmt(num / den)}` : ""}`;

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Enrichment"
        subtitle="How much of the structured enrichment actually lands per source — the arbiter for whether it's worth surfacing, or the extraction needs work."
      />

      <Section
        title="Hiring"
        info="Active job postings. Salary + seniority only land on the structured ATS path ('via ATS' = resolved through a public ATS API). LLM/careers-page jobs carry neither, so a low salary share is expected when few competitors use a supported ATS."
      >
        {m.hiring.total === 0 ? (
          <Empty>No active job postings yet.</Empty>
        ) : (
          <div className="grid grid-cols-2 gap-6 md:grid-cols-4">
            <Stat label="Active jobs" value={m.hiring.total} />
            <Stat label="Via ATS" value={val(m.hiring.viaAts, m.hiring.total)} />
            <Stat label="With seniority" value={val(m.hiring.withSeniority, m.hiring.total)} />
            <Stat label="With salary" value={val(m.hiring.withSalary, m.hiring.total)} />
          </div>
        )}
      </Section>

      <Section
        title="Reviews"
        info="Competitors with at least one recorded review score, and how many also expose a per-criterion breakdown (sub-scores) or clustered complaint themes."
      >
        {m.reviews.withScores === 0 ? (
          <Empty>No review scores recorded yet.</Empty>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
            <Stat label="With scores" value={m.reviews.withScores} />
            <Stat
              label="With sub-scores"
              value={val(m.reviews.withSubScores, m.reviews.withScores)}
            />
            <Stat label="With themes" value={val(m.reviews.withThemes, m.reviews.withScores)} />
          </div>
        )}
      </Section>

      <Section
        title="Platform profile"
        info="Eligible competitors (live URL, not self) and how many have a resolved platform profile (framework / ATS / status page / changelog)."
      >
        {m.platform.eligible === 0 ? (
          <Empty>No eligible competitors yet.</Empty>
        ) : (
          <div className="grid grid-cols-2 gap-6">
            <Stat label="Eligible" value={m.platform.eligible} />
            <Stat
              label="With profile"
              value={val(m.platform.withProfile, m.platform.eligible)}
            />
          </div>
        )}
      </Section>
    </div>
  );
}
