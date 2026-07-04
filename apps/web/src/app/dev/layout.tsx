import { AppProviders } from "@/components/app-providers";

// /dev/* tools (e.g. the cron console) use toast/query, which now live in AppProviders
// instead of the root layout. This local layout re-supplies them without putting them
// back on the public bundle.
export default function DevLayout({ children }: { children: React.ReactNode }) {
  return <AppProviders>{children}</AppProviders>;
}
