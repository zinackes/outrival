import { ProfileSettingsForm } from "@/components/outrival/profile-settings-form";
import { SettingsPageHead } from "@/components/dashboard/settings-page";

export default function ProfileSettingsPage() {
  return (
    <div className="flex flex-col gap-8">
      <SettingsPageHead
        title="Profile"
        description="Your name, your email, and how you sign in."
      />
      <div data-ph-mask>
        <ProfileSettingsForm />
      </div>
    </div>
  );
}
