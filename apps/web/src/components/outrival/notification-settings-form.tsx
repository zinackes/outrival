"use client";

import { useEffect, useState } from "react";
import { api, type NotificationSettings } from "@/lib/api";
import {
  PaywallDialog,
  paywallFromError,
  type PaywallReason,
} from "@/components/outrival/paywall-dialog";

export function NotificationSettingsForm() {
  const [settings, setSettings] = useState<NotificationSettings | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [paywall, setPaywall] = useState<PaywallReason | null>(null);

  useEffect(() => {
    api
      .getNotificationSettings()
      .then(setSettings)
      .catch((e) => setError(String(e)));
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!settings) return;
    setSaving(true);
    setSaved(false);
    setError(null);
    try {
      await api.updateNotificationSettings({
        slackWebhookUrl: settings.slackWebhookUrl || null,
        digestEmail: settings.digestEmail || null,
        digestEnabled: settings.digestEnabled,
        alertsEnabled: settings.alertsEnabled,
      });
      setSaved(true);
    } catch (e) {
      const reason = paywallFromError(e);
      if (reason) {
        setPaywall(reason);
      } else {
        setError(String(e));
      }
    } finally {
      setSaving(false);
    }
  }

  if (error && !settings) return <p style={{ color: "var(--muted)" }} className="text-sm">Erreur : {error}</p>;
  if (!settings) return <p style={{ color: "var(--muted)" }} className="text-sm">Chargement…</p>;

  const inputStyle = {
    background: "var(--surface)",
    border: "1px solid var(--border)",
    borderRadius: "var(--radius)",
    color: "var(--foreground, white)",
  } as const;

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-5 max-w-xl">
      <div>
        <label className="text-sm font-medium mb-1 block">Slack webhook URL</label>
        <input
          type="url"
          value={settings.slackWebhookUrl ?? ""}
          onChange={(e) =>
            setSettings({ ...settings, slackWebhookUrl: e.target.value })
          }
          placeholder="https://hooks.slack.com/services/..."
          style={inputStyle}
          className="w-full px-3 py-2 text-sm"
        />
        <p style={{ color: "var(--muted)" }} className="text-xs mt-1">
          Recevoir les alertes high/critical sur Slack
        </p>
      </div>

      <div>
        <label className="text-sm font-medium mb-1 block">Email pour le digest</label>
        <input
          type="email"
          value={settings.digestEmail ?? ""}
          onChange={(e) =>
            setSettings({ ...settings, digestEmail: e.target.value })
          }
          placeholder="vous@entreprise.com"
          style={inputStyle}
          className="w-full px-3 py-2 text-sm"
        />
      </div>

      <label className="flex items-center gap-3 text-sm">
        <input
          type="checkbox"
          checked={settings.digestEnabled}
          onChange={(e) =>
            setSettings({ ...settings, digestEnabled: e.target.checked })
          }
        />
        Activer le digest hebdomadaire
      </label>

      <label className="flex items-center gap-3 text-sm">
        <input
          type="checkbox"
          checked={settings.alertsEnabled}
          onChange={(e) =>
            setSettings({ ...settings, alertsEnabled: e.target.checked })
          }
        />
        Activer les alertes temps-réel (high/critical)
      </label>

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={saving}
          style={{
            background: "var(--accent)",
            color: "#0a0a0a",
            borderRadius: "var(--radius)",
          }}
          className="px-4 py-2 text-sm font-medium disabled:opacity-50"
        >
          {saving ? "Enregistrement…" : "Enregistrer"}
        </button>
        {saved && (
          <span style={{ color: "var(--accent)" }} className="text-sm">
            ✓ Enregistré
          </span>
        )}
        {error && <span className="text-sm text-red-400">{error}</span>}
      </div>
      <PaywallDialog reason={paywall} onClose={() => setPaywall(null)} />
    </form>
  );
}
