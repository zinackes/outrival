import { PageHead } from "@/components/dashboard/page-head";
import { SettingsNav } from "@/components/dashboard/settings-nav";

export default function SettingsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="max-w-[1100px]">
      <PageHead
        title="Settings"
        sub="Workspace · notifications · subscription"
      />
      <div className="grid gap-8 lg:grid-cols-[180px_1fr] lg:gap-10">
        <SettingsNav />
        <div className="min-w-0">{children}</div>
      </div>
    </div>
  );
}
