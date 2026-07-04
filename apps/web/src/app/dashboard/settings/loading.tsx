import { Skeleton } from "@/components/ui/skeleton";
import { FormSkeleton } from "@/components/dashboard/skeletons";

// Settings pages are form/section shaped, not card grids — a dedicated boundary keeps
// tab-to-tab navigation under /dashboard/settings/* instant with a fitting skeleton
// instead of the generic card grid.
export default function SettingsLoading() {
  return (
    <div aria-busy="true" aria-live="polite">
      <div className="mb-6">
        <Skeleton className="h-6 w-40 mb-2" />
        <Skeleton className="h-4 w-64" />
      </div>
      <FormSkeleton fields={4} />
    </div>
  );
}
