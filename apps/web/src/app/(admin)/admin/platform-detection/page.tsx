import { adminFetch } from "../_lib/server";
import { PlatformDetectionView } from "./view";
import type { AdminPlatformDetection } from "@/lib/api";

export default async function PlatformDetectionPage() {
  const data = await adminFetch<AdminPlatformDetection>("/api/admin/platform-detection");
  return <PlatformDetectionView data={data} />;
}
