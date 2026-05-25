import { NotificationSettingsForm } from "@/components/outrival/notification-settings-form";

export default function SettingsPage() {
  return (
    <div>
      <h1
        style={{ fontFamily: "var(--font-syne)" }}
        className="text-2xl font-bold mb-6"
      >
        Paramètres
      </h1>
      <NotificationSettingsForm />
    </div>
  );
}
