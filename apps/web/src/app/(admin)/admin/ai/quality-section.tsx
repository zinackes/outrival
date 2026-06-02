import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Section, Stat, Empty } from "../_components/shell";

export interface TaskQuality {
  aiTask: string;
  generations: number;
  selfChecked: number;
  failed: number;
  confirmed: number;
  hallucinationRate: number;
  avgGroundingScore: number | null;
}

export interface AiQualityMetrics {
  windowDays: number;
  stats: {
    total: number;
    selfChecked: number;
    failed: number;
    confirmed: number;
    falsePositive: number;
    pending: number;
  };
  byTask: TaskQuality[];
  confidence: { high: number; medium: number; low: number };
}

// Alert threshold mirrored from AI_HALLUCINATION_ALERT_RATE so the table highlights
// the same tasks the ops Slack alert fires on.
const ALERT_RATE = Number(process.env.NEXT_PUBLIC_AI_HALLUCINATION_ALERT_RATE ?? 0.03);

function pct(n: number): string {
  return `${Math.round(n * 100)}%`;
}

export function AiQualitySection({ metrics }: { metrics: AiQualityMetrics | null }) {
  if (!metrics) {
    return (
      <Section title="AI quality (anti-hallucination)">
        <Empty>No quality data yet.</Empty>
      </Section>
    );
  }

  const { stats, byTask, confidence } = metrics;
  const confTotal = confidence.high + confidence.medium + confidence.low;
  // Global estimated hallucination rate over self-checked samples.
  const globalRate = stats.selfChecked > 0 ? stats.confirmed / stats.selfChecked : 0;
  const ranked = [...byTask].sort((a, b) => b.hallucinationRate - a.hallucinationRate);

  return (
    <Section title="AI quality (anti-hallucination)" note={`${metrics.windowDays}d`}>
      <div className="grid grid-cols-2 gap-6 md:grid-cols-4">
        <Stat
          label="Est. hallucination rate"
          value={pct(globalRate)}
          hint={`${stats.confirmed} confirmed / ${stats.selfChecked} checks`}
        />
        <Stat label="High confidence" value={pct(confTotal ? confidence.high / confTotal : 0)} />
        <Stat label="Medium" value={pct(confTotal ? confidence.medium / confTotal : 0)} />
        <Stat label="Low" value={pct(confTotal ? confidence.low / confTotal : 0)} />
      </div>

      {ranked.length === 0 ? (
        <Empty>No AI generations recorded in this window.</Empty>
      ) : (
        <Table className="mt-4">
          <TableHeader>
            <TableRow>
              <TableHead>Task</TableHead>
              <TableHead className="text-right">Generations</TableHead>
              <TableHead className="text-right">Self-checked</TableHead>
              <TableHead className="text-right">Hallucination rate</TableHead>
              <TableHead className="text-right">Avg grounding</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {ranked.map((t) => {
              const over = t.selfChecked >= 5 && t.hallucinationRate > ALERT_RATE;
              return (
                <TableRow key={t.aiTask}>
                  <TableCell className="font-mono text-xs">{t.aiTask}</TableCell>
                  <TableCell className="text-right">{t.generations}</TableCell>
                  <TableCell className="text-right">{t.selfChecked}</TableCell>
                  <TableCell
                    className="text-right"
                    style={over ? { color: "var(--critical)" } : undefined}
                  >
                    {t.selfChecked > 0 ? pct(t.hallucinationRate) : "—"}
                  </TableCell>
                  <TableCell className="text-right">
                    {t.avgGroundingScore != null && t.avgGroundingScore >= 0
                      ? pct(t.avgGroundingScore)
                      : "—"}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}
    </Section>
  );
}
