import { Skeleton } from "@/components/ui/skeleton";
import { FormSkeleton } from "@/components/dashboard/skeletons";

export default function SettingsLoading() {
  return (
    <section className="flex flex-col gap-5" aria-busy="true" aria-live="polite">
      <header>
        <Skeleton className="h-5 w-40 mb-2" />
        <Skeleton className="h-3.5 w-80 max-w-full" />
      </header>
      <FormSkeleton fields={3} />
    </section>
  );
}
