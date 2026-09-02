import Link from "next/link";
import { LinkBreakIcon } from "@/components/icons";
import { EmptyState } from "@/components/dashboard/empty-state";
import { Button } from "@/components/ui/button";

// The 404 boundary for everything under /dashboard, so a dead route keeps the
// sidebar and topbar instead of dropping to Next's chromeless placeholder — the
// live case being a flag-gated route calling notFound() (`ux:03`). The layout
// above supplies the chrome; this is only the panel.
export default function DashboardNotFound() {
  return (
    <div className="mt-10">
      <EmptyState
        icon={LinkBreakIcon}
        title="This page doesn't exist"
        description="The address is wrong, the feature isn't enabled for this workspace, or the page has moved. Nothing is broken."
        actions={
          <Button asChild>
            <Link href="/dashboard">Back to dashboard</Link>
          </Button>
        }
      />
    </div>
  );
}
