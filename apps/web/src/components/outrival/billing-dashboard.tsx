"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  PLAN_LABELS,
  PLAN_LIMITS,
  PLAN_PRICING,
  PLANS,
  type BillingPeriod,
  type Plan,
} from "@outrival/shared";
import { api, type BillingInfo } from "@/lib/api";

type PaidPlan = Exclude<Plan, "free">;

const PAID_PLANS: PaidPlan[] = ["starter", "pro", "business"];

const FEATURE_ROWS: Array<{
  label: string;
  read: (p: Plan) => string | boolean;
}> = [
  {
    label: "Concurrents suivis",
    read: (p) => {
      const lim = PLAN_LIMITS[p].maxCompetitors;
      return Number.isFinite(lim) ? `Jusqu'à ${lim}` : "Illimité";
    },
  },
  {
    label: "Fréquence de scraping",
    read: (p) => {
      const freqs = PLAN_LIMITS[p].allowedFrequencies;
      if (freqs.includes("realtime")) return "Temps réel";
      if (freqs.includes("daily")) return "Quotidien";
      return "Hebdomadaire";
    },
  },
  {
    label: "Sources surveillées",
    read: (p) => `${PLAN_LIMITS[p].allowedSources.length} sources`,
  },
  { label: "Battle cards IA", read: (p) => PLAN_LIMITS[p].features.battleCards },
  { label: "Alertes temps-réel", read: (p) => PLAN_LIMITS[p].features.realtimeAlerts },
  {
    label: "Canaux d'alerte",
    read: (p) => PLAN_LIMITS[p].allowedChannels.join(", "),
  },
  { label: "Accès API", read: (p) => PLAN_LIMITS[p].features.api },
  { label: "Multi-utilisateurs", read: (p) => PLAN_LIMITS[p].features.multiUser },
];

const cardStyle = {
  background: "var(--surface)",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius)",
} as const;

function renderValue(v: string | boolean): React.ReactNode {
  if (v === true) return <span style={{ color: "var(--accent)" }}>✓</span>;
  if (v === false) return <span style={{ color: "var(--muted)" }}>—</span>;
  return <span style={{ color: "var(--foreground, white)" }}>{v}</span>;
}

export function BillingDashboard() {
  const router = useRouter();
  const search = useSearchParams();
  const [billing, setBilling] = useState<BillingInfo | null>(null);
  const [period, setPeriod] = useState<BillingPeriod>("monthly");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    api.getBilling().then(setBilling).catch((e) => setError(String(e)));
  }, []);

  useEffect(() => {
    const status = search.get("status");
    if (status === "success") {
      setToast("Abonnement activé. Le nouveau plan sera disponible dans quelques secondes.");
      // refresh billing after a short delay (webhook may take a moment)
      const t = setTimeout(() => api.getBilling().then(setBilling).catch(() => {}), 2000);
      // clean the query string
      router.replace("/dashboard/settings/billing");
      return () => clearTimeout(t);
    }
    if (status === "cancelled") {
      setToast("Souscription annulée. Aucun changement.");
      router.replace("/dashboard/settings/billing");
    }
  }, [search, router]);

  async function handleCheckout(plan: PaidPlan) {
    setBusy(plan);
    setError(null);
    try {
      const { url } = await api.createCheckout(plan, period);
      window.location.href = url;
    } catch (e) {
      setError(String(e));
      setBusy(null);
    }
  }

  async function handlePortal() {
    setBusy("portal");
    setError(null);
    try {
      const { url } = await api.openPortal();
      window.location.href = url;
    } catch (e) {
      setError(String(e));
      setBusy(null);
    }
  }

  if (error && !billing) {
    return <p style={{ color: "var(--muted)" }} className="text-sm">Erreur : {error}</p>;
  }
  if (!billing) {
    return <p style={{ color: "var(--muted)" }} className="text-sm">Chargement…</p>;
  }

  const used = billing.usage.competitors.used;
  const limit = billing.usage.competitors.limit;
  const usagePct =
    limit !== null && limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 0;
  const isUnlimited = limit === null;

  return (
    <div className="flex flex-col gap-8">
      {toast && (
        <div
          style={{
            ...cardStyle,
            borderColor: "var(--accent)",
            background: "rgba(245, 158, 11, 0.08)",
          }}
          className="px-4 py-3 text-sm"
        >
          {toast}
        </div>
      )}

      <section style={cardStyle} className="p-5">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <p style={{ color: "var(--muted)" }} className="text-xs uppercase tracking-wider mb-1">
              Plan actuel
            </p>
            <h2 style={{ fontFamily: "var(--font-syne)" }} className="text-3xl font-bold">
              {PLAN_LABELS[billing.plan]}
              {billing.planPeriod && (
                <span style={{ color: "var(--muted)" }} className="text-base font-normal ml-2">
                  · {billing.planPeriod === "monthly" ? "mensuel" : "annuel"}
                </span>
              )}
            </h2>
          </div>
          {billing.hasSubscription && (
            <button
              type="button"
              onClick={handlePortal}
              disabled={busy === "portal"}
              style={{
                background: "transparent",
                border: "1px solid var(--border)",
                borderRadius: "var(--radius)",
                color: "var(--foreground, white)",
              }}
              className="px-4 py-2 text-sm hover:bg-white/5 disabled:opacity-50"
            >
              {busy === "portal" ? "Ouverture…" : "Gérer mon abonnement"}
            </button>
          )}
        </div>

        <div className="mt-5">
          <div className="flex items-center justify-between text-sm mb-2">
            <span style={{ color: "var(--muted)" }}>Concurrents suivis</span>
            <span>
              {used} {isUnlimited ? "" : `/ ${limit}`}
              {isUnlimited && (
                <span style={{ color: "var(--muted)" }}> (illimité)</span>
              )}
            </span>
          </div>
          {!isUnlimited && (
            <div
              style={{
                background: "var(--border)",
                borderRadius: "999px",
                height: "6px",
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  width: `${usagePct}%`,
                  height: "100%",
                  background: usagePct >= 100 ? "#ef4444" : "var(--accent)",
                  transition: "width 200ms ease",
                }}
              />
            </div>
          )}
        </div>
      </section>

      <section>
        <div className="flex items-center justify-between mb-4">
          <h2 style={{ fontFamily: "var(--font-syne)" }} className="text-xl font-bold">
            Plans
          </h2>
          <div
            style={{
              ...cardStyle,
              display: "inline-flex",
              padding: "2px",
            }}
          >
            {(["monthly", "yearly"] as const).map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setPeriod(p)}
                style={{
                  background: period === p ? "var(--accent)" : "transparent",
                  color: period === p ? "#0a0a0a" : "var(--muted)",
                  borderRadius: "calc(var(--radius) - 2px)",
                }}
                className="px-3 py-1.5 text-xs font-medium transition-colors"
              >
                {p === "monthly" ? "Mensuel" : "Annuel"}
                {p === "yearly" && (
                  <span className="ml-1" style={{ opacity: 0.8 }}>−17%</span>
                )}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {PLANS.map((plan) => {
            const isCurrent = plan === billing.plan;
            const isPaid = plan !== "free";
            const pricing = isPaid
              ? PLAN_PRICING[plan as PaidPlan][period]
              : 0;
            const monthly = period === "yearly" && isPaid
              ? Math.round((pricing / 12) * 10) / 10
              : pricing;

            return (
              <div
                key={plan}
                style={{
                  ...cardStyle,
                  borderColor: isCurrent ? "var(--accent)" : "var(--border)",
                  boxShadow: isCurrent ? "0 0 0 1px var(--accent) inset" : undefined,
                }}
                className="p-5 flex flex-col gap-4"
              >
                <div>
                  <p style={{ color: "var(--muted)" }} className="text-xs uppercase tracking-wider">
                    {PLAN_LABELS[plan]}
                  </p>
                  <div className="flex items-baseline gap-1 mt-1">
                    <span
                      style={{ fontFamily: "var(--font-syne)" }}
                      className="text-2xl font-bold"
                    >
                      {monthly}€
                    </span>
                    {isPaid && (
                      <span style={{ color: "var(--muted)" }} className="text-xs">
                        /mois
                      </span>
                    )}
                  </div>
                  {period === "yearly" && isPaid && (
                    <p style={{ color: "var(--muted)" }} className="text-xs mt-0.5">
                      facturé {pricing}€ /an
                    </p>
                  )}
                </div>

                {isCurrent ? (
                  <button
                    type="button"
                    disabled
                    style={{
                      background: "transparent",
                      border: "1px solid var(--border)",
                      borderRadius: "var(--radius)",
                      color: "var(--muted)",
                    }}
                    className="w-full px-3 py-2 text-sm"
                  >
                    Plan actuel
                  </button>
                ) : isPaid ? (
                  <button
                    type="button"
                    onClick={() => handleCheckout(plan as PaidPlan)}
                    disabled={Boolean(busy)}
                    style={{
                      background: "var(--accent)",
                      color: "#0a0a0a",
                      borderRadius: "var(--radius)",
                    }}
                    className="w-full px-3 py-2 text-sm font-medium disabled:opacity-50"
                  >
                    {busy === plan ? "Redirection…" : `Passer à ${PLAN_LABELS[plan]}`}
                  </button>
                ) : (
                  <button
                    type="button"
                    disabled
                    style={{
                      background: "transparent",
                      border: "1px solid var(--border)",
                      borderRadius: "var(--radius)",
                      color: "var(--muted)",
                    }}
                    className="w-full px-3 py-2 text-sm"
                  >
                    Gratuit
                  </button>
                )}

                <ul className="flex flex-col gap-2 text-xs">
                  {FEATURE_ROWS.map((row) => (
                    <li key={row.label} className="flex items-start justify-between gap-2">
                      <span style={{ color: "var(--muted)" }}>{row.label}</span>
                      <span className="text-right">{renderValue(row.read(plan))}</span>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      </section>

      {error && (
        <p className="text-sm text-red-400">{error}</p>
      )}
    </div>
  );
}
