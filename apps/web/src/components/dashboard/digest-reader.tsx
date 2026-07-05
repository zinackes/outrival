"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  ArrowRight,
  Download,
  Loader2,
  Mail,
  Flame,
  Activity,
  Minus,
} from "lucide-react";
import { format } from "date-fns";
import { toast } from "sonner";
import { api, ApiError, type Digest } from "@/lib/api";
import { digestDetailQuery, digestsQuery } from "@/lib/queries";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "./empty-state";
import { CatPill } from "./cat-pill";

const TEMP_MAP: Record<
  string,
  { Ic: typeof Flame; color: string; label: string }
> = {
  high: { Ic: Flame, color: "var(--accent)", label: "high" },
  moderate: { Ic: Activity, color: "var(--muted)", label: "moderate" },
  low: { Ic: Minus, color: "var(--muted-2)", label: "low" },
};

export function TempIcon({ level }: { level: string }) {
  const m = TEMP_MAP[level] ?? TEMP_MAP.low!;
  const Ic = m.Ic;
  return (
    <span
      className="inline-flex items-center gap-1.5 text-dense"
      style={{ color: m.color }}
    >
      <Ic size={13} />
      {m.label}
    </span>
  );
}

function urgencyMeta(urgency: string) {
  if (urgency === "action_required") {
    return { title: "Action required", color: "var(--critical)" };
  }
  if (urgency === "watch") {
    return { title: "Watch", color: "var(--accent)" };
  }
  return { title: "FYI", color: "var(--muted)" };
}

function fmtWeek(start: string, end: string) {
  try {
    return `${format(new Date(start), "MMM d")} → ${format(new Date(end), "MMM d, yyyy")}`;
  } catch {
    return `${start} → ${end}`;
  }
}

// A weekly digest reads as a range; a daily one is a single day.
export function digestLabel(d: Pick<Digest, "period" | "weekStart" | "weekEnd">) {
  if (d.period === "daily") {
    try {
      return format(new Date(d.weekStart), "EEE, MMM d, yyyy");
    } catch {
      return d.weekStart;
    }
  }
  return fmtWeek(d.weekStart, d.weekEnd);
}

// Reader route (/dashboard/digests/[id]). Reads the server-seeded detail cache;
// falls back to a client fetch, and renders a graceful not-found state on a miss.
export function DigestReader({ id }: { id: string }) {
  const q = useQuery(digestDetailQuery(id));
  const queryClient = useQueryClient();
  const [sending, setSending] = useState(false);
  const d = q.data;

  async function handleSend() {
    if (!d) return;
    setSending(true);
    try {
      const { sentAt } = await api.sendDigest(d.id);
      queryClient.setQueryData(digestDetailQuery(id).queryKey, { ...d, sentAt });
      void queryClient.invalidateQueries({ queryKey: digestsQuery().queryKey });
      toast.success("Digest sent by email.");
    } catch (e) {
      if (e instanceof ApiError && e.code === "no_recipient") {
        toast.info("Add a recipient email in Digest settings first.");
      } else {
        toast.error("Couldn't send the digest. Try again.");
      }
    } finally {
      setSending(false);
    }
  }

  const backLink = (
    <Button
      variant="ghost"
      size="sm"
      asChild
      className="-mb-2 self-start px-0 hover:bg-transparent"
    >
      <Link href="/dashboard/digests">
        <ArrowLeft size={12} /> Back to digests
      </Link>
    </Button>
  );

  if (q.isLoading && !d) {
    return (
      <div className="space-y-6">
        {backLink}
        <div className="flex items-center gap-2 text-muted-foreground text-sm">
          <Loader2 size={14} className="animate-spin" /> Loading digest…
        </div>
      </div>
    );
  }

  if (!d) {
    return (
      <div className="space-y-6">
        {backLink}
        <EmptyState
          icon={Mail}
          title="Digest not found"
          description="This digest doesn't exist or is no longer available."
        />
      </div>
    );
  }

  const sections = d.content?.sections ?? [];
  const tldr = d.content?.tldr ?? [];
  const crit = sections.filter((s) => s.urgency === "action_required");
  const watch = sections.filter((s) => s.urgency === "watch");
  const fyi = sections.filter((s) => s.urgency === "fyi");
  const periodWord = d.period === "daily" ? "Daily digest" : "Digest";

  return (
    <div className="space-y-6">
      {backLink}

      <div className="flex items-baseline justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-title font-bold tracking-tight m-0">
            {periodWord} · {digestLabel(d)}
          </h1>
          <div className="text-muted-foreground text-dense mt-1.5 flex items-center gap-1.5 flex-wrap">
            <span>{sections.length} signals</span>
            <span className="text-muted-foreground">·</span>
            <span>{crit.length} critical</span>
            <span className="text-muted-foreground">·</span>
            <TempIcon level={d.content?.temperature ?? "low"} />
            {d.sentAt && (
              <>
                <span className="text-muted-foreground">·</span>
                <span>sent {format(new Date(d.sentAt), "MMM d, HH:mm")}</span>
              </>
            )}
          </div>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled
            title="PDF export coming soon"
          >
            <Download size={13} /> PDF
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={sending}
            onClick={handleSend}
          >
            {sending ? (
              <Loader2 size={13} className="animate-spin" />
            ) : (
              <Mail size={13} />
            )}
            {d.sentAt ? "Resend" : "Send by email"}
          </Button>
        </div>
      </div>

      {tldr.length > 0 && (
        <Card className="px-5 py-5">
          <div className="text-xs font-semibold text-primary mb-3">TL;DR</div>
          <ul className="m-0 pl-5 text-content leading-relaxed">
            {tldr.map((t, i) => (
              <li key={i}>{t}</li>
            ))}
          </ul>
        </Card>
      )}

      {[crit, watch, fyi].map((items, idx) => {
        if (items.length === 0) return null;
        const meta = urgencyMeta(items[0]!.urgency);
        return <DigestSection key={idx} meta={meta} items={items} />;
      })}
    </div>
  );
}

function DigestSection({
  meta,
  items,
}: {
  meta: { title: string; color: string };
  items: Array<{
    urgency: string;
    competitor: string;
    category: string;
    insight: string;
    so_what: string;
  }>;
}) {
  return (
    <Card>
      <div className="flex items-center justify-between px-4 py-3 border-b border-border gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <span
            className="size-2 shrink-0 rounded-sm"
            style={{ background: meta.color }}
            aria-hidden
          />
          <div className="font-semibold text-sm tracking-tight">{meta.title}</div>
        </div>
        <span className="text-muted-foreground tabular-nums font-mono text-xs">
          {items.length} signals
        </span>
      </div>
      <div>
        {items.map((s, i) => (
          <div key={i} className="p-5 border-b border-border last:border-b-0">
            <div className="flex items-center gap-2 mb-2 flex-wrap">
              <CatPill>{s.category}</CatPill>
              <span className="font-semibold text-sm">{s.competitor}</span>
            </div>
            <p className="m-0 mb-1.5 text-content leading-snug font-medium">
              {s.insight}
            </p>
            {s.so_what && (
              <p className="m-0 flex gap-1 text-muted-foreground text-sm leading-snug">
                <ArrowRight className="size-3.5 mt-0.5 shrink-0" />
                {s.so_what}
              </p>
            )}
          </div>
        ))}
      </div>
    </Card>
  );
}
