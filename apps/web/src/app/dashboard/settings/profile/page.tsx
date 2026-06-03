import { ProfileSettingsForm } from "@/components/outrival/profile-settings-form";

export default function ProfileSettingsPage() {
  return (
    <section className="flex flex-col gap-5">
      <header>
        <h2 className="font-semibold text-base tracking-tight">Profile</h2>
        <p className="text-muted-foreground text-sm mt-1">
          Your name, email, and how you sign in.
        </p>
      </header>
      <div data-ph-mask>
        <ProfileSettingsForm />
      </div>
    </section>
  );
}
