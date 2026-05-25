import { Suspense } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { BillingDashboard } from "@/components/outrival/billing-dashboard";

export default function BillingPage() {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center gap-3">
        <Link
          href="/dashboard/settings"
          style={{ color: "var(--muted)" }}
          className="flex items-center gap-1.5 text-sm hover:text-white transition-colors"
        >
          <ArrowLeft size={14} />
          Paramètres
        </Link>
      </div>

      <div>
        <h1
          style={{ fontFamily: "var(--font-syne)" }}
          className="text-2xl font-bold mb-2"
        >
          Abonnement
        </h1>
        <p style={{ color: "var(--muted)" }} className="text-sm">
          Gérez votre plan, votre usage et votre méthode de paiement.
        </p>
      </div>

      <Suspense fallback={<p style={{ color: "var(--muted)" }} className="text-sm">Chargement…</p>}>
        <BillingDashboard />
      </Suspense>
    </div>
  );
}
