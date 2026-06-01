import { notFound } from "next/navigation";
import { adminFetch } from "../../_lib/server";
import { UserDetailView } from "./view";
import type { AdminUserDetail } from "@/lib/api";

export default async function UserDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  // The API logs `view_user` to audit_log on this fetch.
  const detail = await adminFetch<AdminUserDetail>(`/api/admin/users/${id}`);
  if (!detail) notFound();
  return <UserDetailView detail={detail} />;
}
