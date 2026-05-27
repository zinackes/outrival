"use client";

import { useEffect } from "react";
import Link from "next/link";
import { Lock, Sparkles } from "lucide-react";
import { PLAN_LABELS, type Plan } from "@outrival/shared";
import { ApiError } from "@/lib/api";
import { track } from "@/lib/posthog/events";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

export type PaywallReason = {
  code: string;
  plan?: Plan;
  limit?: number;
  used?: number;
  feature?: string;
  source?: string;
  frequency?: string;
  channel?: string;
};

export function paywallFromError(err: unknown): PaywallReason | null {
  if (!(err instanceof ApiError)) return null;
  if (err.status !== 403) return null;
  const code = typeof err.code === "string" ? err.code : null;
  if (!code || !code.startsWith("plan_")) return null;
  const d = err.data as Record<string, unknown>;
  return {
    code,
    plan: (d.plan as Plan | undefined) ?? undefined,
    limit: typeof d.limit === "number" ? d.limit : undefined,
    used: typeof d.used === "number" ? d.used : undefined,
    feature: typeof d.feature === "string" ? d.feature : undefined,
    source: typeof d.source === "string" ? d.source : undefined,
    frequency: typeof d.frequency === "string" ? d.frequency : undefined,
    channel: typeof d.channel === "string" ? d.channel : undefined,
  };
}

const FEATURE_LABEL: Record<string, string> = {
  battleCards: "AI battle cards",
  realtimeAlerts: "Real-time alerts",
  api: "API access",
  multiUser: "Multi-user",
};

const SOURCE_LABEL: Record<string, string> = {
  jobs: "Job postings tracking",
  g2_reviews: "G2 reviews",
  capterra_reviews: "Capterra reviews",
  appstore_reviews: "App Store reviews",
};

const CHANNEL_LABEL: Record<string, string> = {
  slack: "Slack notifications",
  webhook: "Outgoing webhooks",
};

function copyFor(reason: PaywallReason): { title: string; body: string } {
  switch (reason.code) {
    case "plan_limit_competitors": {
      const limit = reason.limit ?? 0;
      const planLabel = reason.plan ? PLAN_LABELS[reason.plan] : "current";
      return {
        title: "Competitor limit reached",
        body: `Your ${planLabel} plan lets you track ${limit} competitor${limit > 1 ? "s" : ""}. Upgrade to track more.`,
      };
    }
    case "plan_locked_feature": {
      const label = reason.feature ? FEATURE_LABEL[reason.feature] ?? reason.feature : "This feature";
      return {
        title: `${label} — upgrade required`,
        body: "This feature is available starting with the Pro plan. Upgrade to unlock it.",
      };
    }
    case "plan_locked_source": {
      const label = reason.source ? SOURCE_LABEL[reason.source] ?? reason.source : "This source";
      return {
        title: `${label} — upgrade required`,
        body: "This monitoring source requires a higher plan. Upgrade to unlock it.",
      };
    }
    case "plan_locked_frequency":
      return {
        title: "Frequency not available on your plan",
        body: `The "${reason.frequency ?? "requested"}" frequency requires a higher plan. Upgrade to scrape more often.`,
      };
    case "plan_locked_channel": {
      const label = reason.channel ? CHANNEL_LABEL[reason.channel] ?? reason.channel : "This channel";
      return {
        title: `${label} — upgrade required`,
        body: "This notification channel requires a higher plan.",
      };
    }
    default:
      return {
        title: "This action is not available on your plan",
        body: "Upgrade to unlock this feature.",
      };
  }
}

export function PaywallDialog({
  reason,
  onClose,
}: {
  reason: PaywallReason | null;
  onClose: () => void;
}) {
  const open = reason !== null;
  const copy = reason ? copyFor(reason) : null;

  useEffect(() => {
    if (reason) track("paywall_shown", { reason: reason.code });
  }, [reason]);

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <div className="flex items-center justify-center w-10 h-10 rounded-full bg-[var(--accent-dim)]">
          <Lock size={18} className="text-primary" />
        </div>
        <DialogHeader>
          <DialogTitle>{copy?.title}</DialogTitle>
          <DialogDescription>{copy?.body}</DialogDescription>
        </DialogHeader>
        {reason?.used !== undefined && reason?.limit !== undefined && (
          <p className="text-xs text-muted-foreground">
            You&apos;re currently using {reason.used} / {reason.limit}{" "}
            competitors.
          </p>
        )}
        <DialogFooter>
          <Button variant="secondary" onClick={onClose}>
            Later
          </Button>
          <Button asChild>
            <Link
              href="/dashboard/settings/billing"
              onClick={() => {
                if (reason) track("paywall_cta_clicked", { reason: reason.code });
                onClose();
              }}
            >
              <Sparkles size={14} /> View plans
            </Link>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
