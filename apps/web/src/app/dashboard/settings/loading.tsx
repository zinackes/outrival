import { Skeleton } from "@/components/ui/skeleton";
import { SettingRowsSkeleton } from "@/components/dashboard/skeletons";

// Settings pages are section-shaped, not card grids — a dedicated boundary keeps
// tab-to-tab navigation under /dashboard/settings/* instant with a fitting
// skeleton instead of the generic card grid.
//
// OUT-38: the title bar was `h-6` (24px) where the real h1 is text-title (26px),
// so every settings page shifted down a few pixels the moment it resolved.
export default function SettingsLoading() {
  return (
    <div className="flex flex-col gap-8" aria-busy="true" aria-live="polite">
      <div>
        <Skeleton className="h-8 w-44" />
        <Skeleton className="mt-2.5 h-3.5 w-80" />
      </div>
      <div>
        <Skeleton className="h-4 w-32" />
        <div className="mt-3">
          <SettingRowsSkeleton rows={4} />
        </div>
      </div>
    </div>
  );
}
