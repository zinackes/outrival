"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { emailSchema } from "@outrival/shared";
import { useSession, authClient } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FormSkeleton } from "@/components/dashboard/skeletons";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "";

async function authPost(path: string, body: Record<string, unknown>): Promise<void> {
  const res = await fetch(`${API_URL}/api/auth/${path}`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { message?: string };
    throw new Error(typeof data.message === "string" ? data.message : "Request failed");
  }
}

// Self-serve email change via Better Auth emailOTP: a code goes to the new
// address (anti-enumeration: the server stays silent if it's already taken), and
// the email only switches once the user confirms that code.
function EmailField({ currentEmail }: { currentEmail: string }) {
  const router = useRouter();
  const [mode, setMode] = useState<"view" | "email" | "code">("view");
  const [newEmail, setNewEmail] = useState("");
  const [otp, setOtp] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const emailValid = emailSchema.safeParse(newEmail.trim()).success;

  function reset() {
    setMode("view");
    setNewEmail("");
    setOtp("");
    setError("");
  }

  async function sendCode() {
    setBusy(true);
    setError("");
    try {
      await authPost("email-otp/request-email-change", { newEmail: newEmail.trim() });
      setMode("code");
      toast.success("If that address is available, a code is on its way.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't send the code.");
    } finally {
      setBusy(false);
    }
  }

  async function confirm() {
    setBusy(true);
    setError("");
    try {
      await authPost("email-otp/change-email", { newEmail: newEmail.trim(), otp });
      toast.success("Email updated.");
      reset();
      router.refresh();
    } catch {
      setError("That code didn't match or has expired. Request a new one.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor="profile-email">Email</Label>

      {mode === "view" && (
        <>
          <Input
            id="profile-email"
            value={currentEmail}
            readOnly
            disabled
            className="max-w-sm"
            data-ph-mask
          />
          <div>
            <Button variant="outline" size="sm" onClick={() => setMode("email")}>
              Change email
            </Button>
          </div>
        </>
      )}

      {mode === "email" && (
        <div className="flex flex-col gap-2 max-w-sm">
          <Input
            id="profile-email"
            type="email"
            autoFocus
            value={newEmail}
            onChange={(e) => setNewEmail(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && emailValid && !busy) void sendCode();
            }}
            placeholder="new@your-company.com"
            autoComplete="email"
            data-ph-mask
          />
          <p className="text-xs text-muted-foreground">
            We'll send a 6-digit code to this address to confirm it's yours.
          </p>
          <div className="flex items-center gap-2">
            <Button size="sm" onClick={sendCode} disabled={!emailValid || busy}>
              {busy && <Loader2 size={13} className="animate-spin" />}
              Send code
            </Button>
            <Button variant="ghost" size="sm" onClick={reset} disabled={busy}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      {mode === "code" && (
        <div className="flex flex-col gap-2 max-w-sm">
          <Input
            autoFocus
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            value={otp}
            onChange={(e) => setOtp(e.target.value.replace(/\D/g, "").slice(0, 6))}
            onKeyDown={(e) => {
              if (e.key === "Enter" && otp.length === 6 && !busy) void confirm();
            }}
            placeholder="123456"
            className="font-mono tracking-[0.3em]"
          />
          <p className="text-xs text-muted-foreground" data-ph-mask>
            Enter the code sent to {newEmail.trim()}.
          </p>
          <div className="flex items-center gap-2">
            <Button size="sm" onClick={confirm} disabled={otp.length < 6 || busy}>
              {busy && <Loader2 size={13} className="animate-spin" />}
              Confirm new email
            </Button>
            <Button variant="ghost" size="sm" onClick={reset} disabled={busy}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      {error && (
        <p className="text-dense text-destructive" role="alert">
          {error}
        </p>
      )}
    </div>
  );
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

      <EmailField currentEmail={email} />

      <div>
        <Button size="sm" onClick={save} disabled={!dirty || saving}>
          {saving && <Loader2 size={13} className="animate-spin" />}
          Save changes
        </Button>
      </div>
    </div>
  );
}
