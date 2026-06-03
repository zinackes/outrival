"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useSession, authClient } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FormSkeleton } from "@/components/dashboard/skeletons";

function initials(name?: string | null, fallback = "?") {
  if (!name) return fallback;
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts.map((p) => p[0]?.toUpperCase() ?? "").join("") || fallback;
}

export function ProfileSettingsForm() {
  const router = useRouter();
  const { data: session, isPending } = useSession();
  const currentName = session?.user?.name ?? "";
  const email = session?.user?.email ?? "";

  const [name, setName] = useState(currentName);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setName(currentName);
  }, [currentName]);

  if (isPending && !session) {
    return <FormSkeleton />;
  }

  const dirty = name.trim() !== currentName && name.trim().length > 0;

  async function save() {
    setSaving(true);
    try {
      const res = await authClient.updateUser({ name: name.trim() });
      if (res.error) throw new Error(res.error.message ?? "Update failed");
      toast.success("Profile updated");
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not update profile");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center gap-3">
        <span className="flex aspect-square size-12 items-center justify-center rounded-full border border-border bg-surface text-sm font-semibold text-foreground">
          {initials(currentName, "?")}
        </span>
        <p className="text-[13px] text-muted-foreground">
          Your avatar is generated from your name.
        </p>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="profile-name">Name</Label>
        <Input
          id="profile-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Your name"
          className="max-w-sm"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="profile-email">Email</Label>
        <Input
          id="profile-email"
          value={email}
          readOnly
          disabled
          className="max-w-sm"
          data-ph-mask
        />
        <p className="text-[12px] text-muted-foreground/80">
          Email changes aren&apos;t available yet — contact support to update it.
        </p>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label>Password</Label>
        <p className="text-[13px] text-muted-foreground">
          You sign in with a magic link or Google. Setting a password is optional and
          coming soon.
        </p>
        <div>
          <Button variant="outline" size="sm" disabled>
            Set a password
          </Button>
        </div>
      </div>

      <div>
        <Button size="sm" onClick={save} disabled={!dirty || saving}>
          {saving && <Loader2 size={13} className="animate-spin" />}
          Save changes
        </Button>
      </div>
    </div>
  );
}
