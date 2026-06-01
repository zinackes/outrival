import { adminFetch } from "../_lib/server";
import { UsersView } from "./view";
import type { AdminUserRow } from "@/lib/api";

export default async function UsersPage() {
  const data = await adminFetch<{ users: AdminUserRow[] }>("/api/admin/users");
  return <UsersView initial={data?.users ?? []} />;
}
