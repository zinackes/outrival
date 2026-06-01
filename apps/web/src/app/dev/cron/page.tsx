import { notFound } from "next/navigation";
import { CronConsole } from "./cron-console";

// DEV-ONLY — manual cron trigger console. No nav link points here; this guard
// 404s the route in production and the /api/dev backend is unmounted there too.
// Delete the whole apps/web/src/app/dev folder before shipping.
export default function DevCronPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return <CronConsole />;
}
