"use client";

import { useRouter } from "next/navigation";
import { LogOut } from "lucide-react";
import { signOut } from "@/lib/auth-client";

export function LogoutButton() {
  const router = useRouter();

  async function handleLogout() {
    await signOut();
    router.push("/login");
  }

  return (
    <button
      onClick={handleLogout}
      style={{ borderRadius: "var(--radius)", color: "var(--muted)" }}
      className="flex items-center gap-3 px-3 py-2 text-sm hover:bg-white/5 hover:text-white transition-colors w-full"
    >
      <LogOut size={16} />
      Logout
    </button>
  );
}
