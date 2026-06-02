import { NotificationSettingsForm } from "@/components/outrival/notification-settings-form";

export default function NotificationSettingsPage() {
  return (
    <section className="flex flex-col gap-5">
      <header>
        <h2 className="font-semibold text-base tracking-tight">Notifications</h2>
        <p className="text-muted-foreground text-sm mt-1">
          Slack webhook, digest email, and real-time alert thresholds.
        </p>
      </header>
      <div data-ph-mask>
        <NotificationSettingsForm />
      </div>
    </section>
  );
}
