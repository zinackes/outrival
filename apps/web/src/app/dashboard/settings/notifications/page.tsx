import { NotificationSettingsForm } from "@/components/outrival/notification-settings-form";
import { NotificationModerationForm } from "@/components/outrival/notification-moderation-form";

export default function NotificationSettingsPage() {
  return (
    <section className="flex flex-col gap-10">
      <div className="flex flex-col gap-5">
        <header>
          <h2 className="font-semibold text-base tracking-tight">Notifications</h2>
          <p className="text-muted-foreground text-sm mt-1">
            Slack webhook, digest email, and real-time alert thresholds.
          </p>
        </header>
        <div data-ph-mask>
          <NotificationSettingsForm />
        </div>
      </div>

      <div className="flex flex-col gap-5">
        <header>
          <h2 className="font-semibold text-base tracking-tight">Moderation</h2>
          <p className="text-muted-foreground text-sm mt-1">
            Control how much reaches you: channels by priority, quiet hours, a daily
            email limit, and grouping. Critical alerts always come through.
          </p>
        </header>
        <NotificationModerationForm />
      </div>
    </section>
  );
}
