import Link from "next/link";
import { ChevronRight, CreditCard } from "lucide-react";
import { NotificationSettingsForm } from "@/components/outrival/notification-settings-form";

export default function SettingsPage() {
  return (
    <div className="flex flex-col gap-8 max-w-2xl">
      <h1
        style={{ fontFamily: "var(--font-syne)" }}
        className="text-2xl font-bold"
      >
        Paramètres
      </h1>

      <section>
        <h2
          style={{ fontFamily: "var(--font-syne)" }}
          className="text-base font-semibold mb-3"
        >
          Notifications
        </h2>
        <NotificationSettingsForm />
      </section>

      <section>
        <h2
          style={{ fontFamily: "var(--font-syne)" }}
          className="text-base font-semibold mb-3"
        >
          Abonnement
        </h2>
        <Link
          href="/dashboard/settings/billing"
          style={{
            background: "var(--surface)",
            border: "1px solid var(--border)",
            borderRadius: "var(--radius)",
          }}
          className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-white/5 transition-colors"
        >
          <div className="flex items-center gap-3">
            <CreditCard size={18} style={{ color: "var(--muted)" }} />
            <div>
              <p className="text-sm font-medium">Plan et facturation</p>
              <p style={{ color: "var(--muted)" }} className="text-xs">
                Gérer l'abonnement, voir l'usage et changer de plan
              </p>
            </div>
          </div>
          <ChevronRight size={16} style={{ color: "var(--muted)" }} />
        </Link>
      </section>
    </div>
  );
}
