"use client";

import Link from "next/link";
import { Lock, Sparkles } from "lucide-react";
import { PLAN_LABELS, type Plan } from "@outrival/shared";
import { ApiError } from "@/lib/api";

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
  battleCards: "Battle cards IA",
  realtimeAlerts: "Alertes temps-réel",
  api: "Accès API",
  multiUser: "Multi-utilisateurs",
};

const SOURCE_LABEL: Record<string, string> = {
  jobs: "Suivi des offres d'emploi",
  g2_reviews: "Reviews G2",
  capterra_reviews: "Reviews Capterra",
  appstore_reviews: "Reviews App Store",
};

const CHANNEL_LABEL: Record<string, string> = {
  slack: "Notifications Slack",
  webhook: "Webhooks sortants",
};

function copyFor(reason: PaywallReason): { title: string; body: string } {
  switch (reason.code) {
    case "plan_limit_competitors": {
      const limit = reason.limit ?? 0;
      const planLabel = reason.plan ? PLAN_LABELS[reason.plan] : "actuel";
      return {
        title: "Limite de concurrents atteinte",
        body: `Votre plan ${planLabel} permet de suivre ${limit} concurrent${limit > 1 ? "s" : ""}. Passez à un plan supérieur pour en suivre davantage.`,
      };
    }
    case "plan_locked_feature": {
      const label = reason.feature ? FEATURE_LABEL[reason.feature] ?? reason.feature : "Cette fonctionnalité";
      return {
        title: `${label} — plan supérieur requis`,
        body: "Cette fonctionnalité est disponible à partir du plan Pro. Passez à un plan supérieur pour la débloquer.",
      };
    }
    case "plan_locked_source": {
      const label = reason.source ? SOURCE_LABEL[reason.source] ?? reason.source : "Cette source";
      return {
        title: `${label} — plan supérieur requis`,
        body: "Cette source de surveillance nécessite un plan supérieur. Passez à un plan supérieur pour la débloquer.",
      };
    }
    case "plan_locked_frequency":
      return {
        title: "Fréquence non disponible sur votre plan",
        body: `La fréquence "${reason.frequency ?? "demandée"}" nécessite un plan supérieur. Passez à un plan supérieur pour scraper plus souvent.`,
      };
    case "plan_locked_channel": {
      const label = reason.channel ? CHANNEL_LABEL[reason.channel] ?? reason.channel : "Ce canal";
      return {
        title: `${label} — plan supérieur requis`,
        body: "Ce canal de notification nécessite un plan supérieur.",
      };
    }
    default:
      return {
        title: "Cette action n'est pas disponible sur votre plan",
        body: "Passez à un plan supérieur pour débloquer cette fonctionnalité.",
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
  if (!reason) return null;
  const { title, body } = copyFor(reason);

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "var(--surface)",
          border: "1px solid var(--border)",
          borderRadius: "var(--radius)",
        }}
        className="w-full max-w-md p-6 flex flex-col gap-4"
      >
        <div
          style={{
            background: "rgba(245, 158, 11, 0.12)",
            borderRadius: "999px",
            width: "40px",
            height: "40px",
          }}
          className="flex items-center justify-center"
        >
          <Lock size={18} style={{ color: "var(--accent)" }} />
        </div>
        <div>
          <h2 style={{ fontFamily: "var(--font-syne)" }} className="text-lg font-bold mb-1">
            {title}
          </h2>
          <p style={{ color: "var(--muted)" }} className="text-sm">
            {body}
          </p>
          {reason.used !== undefined && reason.limit !== undefined && (
            <p style={{ color: "var(--muted)" }} className="text-xs mt-2">
              Vous utilisez actuellement {reason.used} / {reason.limit} concurrents.
            </p>
          )}
        </div>
        <div className="flex items-center justify-end gap-2 mt-2">
          <button
            type="button"
            onClick={onClose}
            style={{
              background: "transparent",
              border: "1px solid var(--border)",
              borderRadius: "var(--radius)",
            }}
            className="px-4 py-2 text-sm hover:bg-white/5"
          >
            Plus tard
          </button>
          <Link
            href="/dashboard/settings/billing"
            onClick={onClose}
            style={{
              background: "var(--accent)",
              color: "#0a0a0a",
              borderRadius: "var(--radius)",
            }}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium hover:opacity-90"
          >
            <Sparkles size={14} /> Voir les plans
          </Link>
        </div>
      </div>
    </div>
  );
}
