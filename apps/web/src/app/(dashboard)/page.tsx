import { ActivityFeed } from "@/components/outrival/activity-feed";

export default function DashboardHomePage() {
  return (
    <div>
      <h1 style={{ fontFamily: "var(--font-syne)" }} className="text-2xl font-bold mb-6">
        Activité récente
      </h1>
      <ActivityFeed />
    </div>
  );
}
