"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { KeyRound, Link2, Loader2, Monitor, ShieldCheck } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";
import { useSession, authClient } from "@/lib/auth-client";
import { api, ApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FormSkeleton } from "@/components/dashboard/skeletons";

interface SessionRow {
  id: string;
  token: string;
  userAgent: string | null;
  ipAddress: string | null;
  createdAt: string;
}

// Magic-link / Google accounts have no credential account: they SET a first
// password (no current one to ask for). Accounts that already have one CHANGE
// it — current password required, other sessions revoked server-side.
function PasswordCard({ onPasswordChanged }: { onPasswordChanged: () => void }) {
  const [hasPassword, setHasPassword] = useState<boolean | null>(null);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    authClient
      .listAccounts()
      .then((res) =>
        setHasPassword((res.data ?? []).some((a) => a.providerId === "credential")),
      )
      .catch(() => setHasPassword(false));
  }, []);

  async function submit() {
    setSaving(true);
    try {
      const r = await api.setPassword({
        newPassword,
        ...(hasPassword ? { currentPassword } : {}),
      });
      setCurrentPassword("");
      setNewPassword("");
      setHasPassword(true);
      toast.success(
        r.changed ? "Password changed — other sessions signed out." : "Password set.",
      );
      if (r.changed) onPasswordChanged();
    } catch (e) {
      const msg =
        e instanceof ApiError && typeof e.data.message === "string"
          ? e.data.message
          : "Couldn't update the password.";
      toast.error(msg);
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="flex flex-col gap-5">
      <header>
        <h2 className="font-semibold text-base tracking-tight">Password</h2>
        <p className="text-muted-foreground text-sm mt-1">
          {hasPassword
            ? "Change the password used as a sign-in fallback."
            : "Set a password to sign in without a magic link."}
        </p>
      </header>
      <Card className="flex flex-col gap-4 px-5 py-4">
        <div className="flex items-center gap-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-md border border-border bg-background text-muted-foreground">
            <KeyRound size={16} />
          </span>
          <div className="text-xs text-muted-foreground font-mono">
            {hasPassword === null
              ? "Checking…"
              : hasPassword
                ? "Status: password set"
                : "Status: no password"}
          </div>
        </div>
        <div className="flex flex-col gap-3 sm:max-w-sm">
          {hasPassword && (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="current-password" className="text-dense">
                Current password
              </Label>
              <Input
                id="current-password"
                type="password"
                autoComplete="current-password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
              />
            </div>
          )}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="new-password" className="text-dense">
              New password
            </Label>
            <Input
              id="new-password"
              type="password"
              autoComplete="new-password"
              placeholder="At least 12 characters"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
            />
          </div>
          <div>
            <Button
              size="sm"
              onClick={submit}
              disabled={
                saving ||
                hasPassword === null ||
                newPassword.length < 12 ||
                (hasPassword === true && !currentPassword)
              }
            >
              {saving && <Loader2 size={13} className="animate-spin" />}
              {hasPassword ? "Change password" : "Set password"}
            </Button>
          </div>
        </div>
      </Card>
    </section>
  );
}

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "";

// Better Auth 2FA endpoints are session-authenticated; credentials:"include"
// sends the cross-subdomain cookie, matching the rest of the client.
async function twoFactorRequest<T = Record<string, unknown>>(
  action: string,
  body: Record<string, unknown> = {},
): Promise<T> {
  const res = await fetch(`${API_URL}/api/auth/two-factor/${action}`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    throw new Error(typeof data.message === "string" ? data.message : "Something went wrong.");
  }
  return data as T;
}

function secretFromUri(uri: string): string | null {
  return /[?&]secret=([^&]+)/.exec(uri)?.[1] ?? null;
}

// Authenticator-app 2FA. Enabling is verify-first: we fetch a secret + backup
// codes, the user scans/enters them, then confirms a TOTP code — only then is 2FA
// switched on server-side, so an abandoned setup never locks anyone out. Sign-in
// enforcement (incl. the email-code & Google paths) lives in the API auth hook.
function TwoFactorCard({ initialEnabled }: { initialEnabled: boolean }) {
  const router = useRouter();
  const [enabled, setEnabled] = useState(initialEnabled);
  const [setup, setSetup] = useState<{
    totpURI: string;
    secret: string | null;
    backupCodes: string[];
  } | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function startEnable() {
    setBusy(true);
    setError("");
    try {
      const data = await twoFactorRequest<{ totpURI: string; backupCodes?: string[] }>("enable");
      setSetup({
        totpURI: data.totpURI,
        secret: secretFromUri(data.totpURI),
        backupCodes: data.backupCodes ?? [],
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't start 2FA setup.");
    } finally {
      setBusy(false);
    }
  }

  async function confirmEnable() {
    if (code.length < 6) return;
    setBusy(true);
    setError("");
    try {
      await twoFactorRequest("verify-totp", { code });
      setEnabled(true);
      setSetup(null);
      setCode("");
      toast.success("Two-factor authentication is on.");
      router.refresh();
    } catch {
      setError("That code didn't match. Check your authenticator app and try again.");
    } finally {
      setBusy(false);
    }
  }

  async function disable() {
    setBusy(true);
    setError("");
    try {
      await twoFactorRequest("disable");
      setEnabled(false);
      toast.success("Two-factor authentication is off.");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't disable 2FA.");
    } finally {
      setBusy(false);
    }
  }

  if (setup) {
    return (
      <Card className="flex flex-col gap-5 px-5 py-5">
        <div className="flex flex-col gap-1">
          <div className="text-dense font-medium text-foreground">
            Scan with your authenticator app
          </div>
          <p className="text-sm text-muted-foreground">
            Use Google Authenticator, 1Password, Authy, or similar, then enter the
            6-digit code to finish.
          </p>
        </div>

        <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
          {/* QR needs a light tile in both themes to stay scannable. */}
          <div className="w-fit rounded-lg bg-white p-3">
            <QRCodeSVG value={setup.totpURI} size={148} />
          </div>
          <div className="flex flex-1 flex-col gap-3">
            {setup.secret && (
              <div className="flex flex-col gap-1">
                <span className="text-meta text-muted-foreground">Or enter this key manually</span>
                <code className="select-all break-all rounded-md border border-border bg-background px-2.5 py-1.5 font-mono text-dense text-foreground">
                  {setup.secret}
                </code>
              </div>
            )}
            {setup.backupCodes.length > 0 && (
              <div className="flex flex-col gap-1.5">
                <span className="text-meta text-muted-foreground">
                  Backup codes — save these now, each works once if you lose your device
                </span>
                <div className="grid grid-cols-2 gap-1.5 rounded-md border border-border bg-background p-2.5">
                  {setup.backupCodes.map((c) => (
                    <code key={c} className="select-all font-mono text-dense text-foreground">
                      {c}
                    </code>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="flex flex-col gap-2 sm:max-w-xs">
          <Label htmlFor="totp-confirm" className="text-dense">
            6-digit code
          </Label>
          <Input
            id="totp-confirm"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            placeholder="123456"
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
            className="font-mono tracking-[0.3em]"
          />
        </div>

        {error && (
          <p className="text-dense text-destructive" role="alert">
            {error}
          </p>
        )}

        <div className="flex items-center gap-2">
          <Button size="sm" onClick={confirmEnable} disabled={busy || code.length < 6}>
            {busy && <Loader2 size={13} className="animate-spin" />}
            Confirm and enable
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setSetup(null);
              setCode("");
              setError("");
            }}
            disabled={busy}
          >
            Cancel
          </Button>
        </div>
      </Card>
    );
  }

  return (
    <Card className="flex items-center gap-3 px-5 py-4">
      <span className="flex size-9 shrink-0 items-center justify-center rounded-md border border-border bg-background text-muted-foreground">
        <ShieldCheck size={16} />
      </span>
      <div className="flex-1">
        <div className="text-dense font-medium">Authenticator app</div>
        <div className="text-xs text-muted-foreground font-mono">
          {enabled ? "Status: enabled" : "Status: disabled"}
        </div>
        {error && (
          <p className="mt-1 text-dense text-destructive" role="alert">
            {error}
          </p>
        )}
      </div>
      {enabled ? (
        <Button variant="outline" size="sm" onClick={disable} disabled={busy}>
          {busy && <Loader2 size={13} className="animate-spin" />}
          Disable 2FA
        </Button>
      ) : (
        <Button variant="outline" size="sm" onClick={startEnable} disabled={busy}>
          {busy && <Loader2 size={13} className="animate-spin" />}
          Enable 2FA
        </Button>
      )}
    </Card>
  );
}

const PASSKEYS_ENABLED = process.env.NEXT_PUBLIC_PASSKEYS_ENABLED === "true";

interface PasskeyRow {
  id: string;
  name?: string | null;
  createdAt?: string | null;
}

// Passkeys (WebAuthn) — register/list/remove device-bound credentials. Adding a
// passkey runs a browser ceremony (authClient.passkey.addPasskey); listing and
// removal hit the plugin routes directly. Gated behind NEXT_PUBLIC_PASSKEYS_ENABLED
// until verified on staging with a real device.
function PasskeysCard() {
  const [passkeys, setPasskeys] = useState<PasskeyRow[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(() => {
    fetch(`${API_URL}/api/auth/passkey/list-user-passkeys`, { credentials: "include" })
      .then((r) => (r.ok ? r.json() : []))
      .then((rows) => setPasskeys(Array.isArray(rows) ? rows : []))
      .catch(() => setPasskeys([]));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function add() {
    setBusy("add");
    try {
      const res = await authClient.passkey.addPasskey();
      if (res?.error) {
        // A user-cancelled ceremony surfaces as an error too — keep it quiet-ish.
        toast.error(res.error.message || "Couldn't add that passkey.");
      } else {
        toast.success("Passkey added.");
        load();
      }
    } catch {
      toast.error("Couldn't add that passkey.");
    } finally {
      setBusy(null);
    }
  }

  async function remove(id: string) {
    setBusy(id);
    try {
      const r = await fetch(`${API_URL}/api/auth/passkey/delete-passkey`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      if (!r.ok) throw new Error();
      toast.success("Passkey removed.");
      load();
    } catch {
      toast.error("Couldn't remove that passkey.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      {passkeys === null ? (
        <FormSkeleton />
      ) : passkeys.length === 0 ? (
        <Card className="px-5 py-6 text-dense text-muted-foreground">
          No passkeys yet. Add one to sign in with Face ID, Touch ID, or a security key.
        </Card>
      ) : (
        <Card className="divide-y divide-border overflow-hidden">
          {passkeys.map((p) => (
            <div key={p.id} className="flex items-center gap-3 px-5 py-3.5">
              <span className="flex size-8 shrink-0 items-center justify-center rounded-md border border-border bg-background text-muted-foreground">
                <KeyRound size={14} />
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-dense font-medium">{p.name || "Passkey"}</div>
                {p.createdAt && (
                  <div className="text-meta text-muted-foreground font-mono">
                    Added {formatDistanceToNow(new Date(p.createdAt), { addSuffix: true })}
                  </div>
                )}
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => remove(p.id)}
                disabled={busy === p.id}
              >
                {busy === p.id && <Loader2 size={13} className="animate-spin" />}
                Remove
              </Button>
            </div>
          ))}
        </Card>
      )}
      <div>
        <Button variant="outline" size="sm" onClick={add} disabled={busy === "add"}>
          {busy === "add" && <Loader2 size={13} className="animate-spin" />}
          Add a passkey
        </Button>
      </div>
    </div>
  );
}

const PROVIDER_LABELS: Record<string, string> = {
  google: "Google",
  credential: "Email & password",
};

// Lists linked OAuth providers and lets the user disconnect them. Email-code
// sign-in always works, so disconnecting a provider never locks anyone out.
function ConnectedAccountsCard() {
  const [accounts, setAccounts] = useState<{ providerId: string }[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(() => {
    authClient
      .listAccounts()
      .then((res) => setAccounts((res.data ?? []).map((a) => ({ providerId: a.providerId }))))
      .catch(() => setAccounts([]));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function disconnect(providerId: string) {
    setBusy(providerId);
    try {
      await api.disconnectOAuth(providerId);
      toast.success(`${PROVIDER_LABELS[providerId] ?? providerId} disconnected`);
      load();
    } catch (e) {
      toast.error(
        e instanceof ApiError && typeof e.data.message === "string"
          ? e.data.message
          : "Couldn't disconnect that account.",
      );
    } finally {
      setBusy(null);
    }
  }

  const social = (accounts ?? []).filter((a) => a.providerId !== "credential");

  if (accounts === null) return <FormSkeleton />;

  if (social.length === 0) {
    return (
      <Card className="px-5 py-6 text-dense text-muted-foreground">
        No third-party sign-ins connected. You can always sign in with an email code.
      </Card>
    );
  }

  return (
    <Card className="divide-y divide-border overflow-hidden">
      {social.map((a) => (
        <div key={a.providerId} className="flex items-center gap-3 px-5 py-3.5">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-md border border-border bg-background text-muted-foreground">
            <Link2 size={14} />
          </span>
          <div className="min-w-0 flex-1 text-dense font-medium">
            {PROVIDER_LABELS[a.providerId] ?? a.providerId}
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => disconnect(a.providerId)}
            disabled={busy === a.providerId}
          >
            {busy === a.providerId && <Loader2 size={13} className="animate-spin" />}
            Disconnect
          </Button>
        </div>
      ))}
    </Card>
  );
}

function deviceLabel(userAgent: string | null): string {
  if (!userAgent) return "Unknown device";
  const ua = userAgent;
  const os =
    /Windows/.test(ua) ? "Windows"
    : /Mac OS X|Macintosh/.test(ua) ? "macOS"
    : /iPhone|iPad/.test(ua) ? "iOS"
    : /Android/.test(ua) ? "Android"
    : /Linux/.test(ua) ? "Linux"
    : "";
  const browser =
    /Edg\//.test(ua) ? "Edge"
    : /Chrome\//.test(ua) ? "Chrome"
    : /Firefox\//.test(ua) ? "Firefox"
    : /Safari\//.test(ua) ? "Safari"
    : "Browser";
  return [browser, os].filter(Boolean).join(" · ");
}

export function SecuritySettings() {
  const router = useRouter();
  const { data: session } = useSession();
  const currentToken = session?.session?.token;
  // twoFactorEnabled isn't in the base client's user type (no client plugin), so
  // read it off the returned session object.
  const twoFactorEnabled = Boolean(
    (session?.user as { twoFactorEnabled?: boolean } | undefined)?.twoFactorEnabled,
  );

  const [sessions, setSessions] = useState<SessionRow[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(() => {
    authClient
      .listSessions()
      .then((res) => {
        const rows = res.data ?? [];
        setSessions(
          rows.map((s) => ({
            id: s.id,
            token: s.token,
            userAgent: s.userAgent ?? null,
            ipAddress: s.ipAddress ?? null,
            createdAt: new Date(s.createdAt).toISOString(),
          })),
        );
      })
      .catch(() => setSessions([]));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function revokeOne(token: string) {
    setBusy(token);
    try {
      await authClient.revokeSession({ token });
      toast.success("Session signed out");
      load();
    } catch {
      toast.error("Could not sign out that session");
    } finally {
      setBusy(null);
    }
  }

  async function revokeOthers() {
    setBusy("others");
    try {
      await authClient.revokeOtherSessions();
      toast.success("Other sessions signed out");
      load();
    } catch {
      toast.error("Could not sign out other sessions");
    } finally {
      setBusy(null);
    }
  }

  const hasOthers =
    !!sessions && sessions.some((s) => s.token !== currentToken);

  return (
    <div className="flex flex-col gap-10">
      <PasswordCard onPasswordChanged={load} />

      <section className="flex flex-col gap-5">
        <header>
          <h2 className="font-semibold text-base tracking-tight">
            Two-factor authentication
          </h2>
          <p className="text-muted-foreground text-sm mt-1">
            Require a code from your authenticator app on every sign-in — email
            code, Google, and password alike.
          </p>
        </header>
        <TwoFactorCard
          key={String(twoFactorEnabled)}
          initialEnabled={twoFactorEnabled}
        />
      </section>

      {PASSKEYS_ENABLED && (
        <section className="flex flex-col gap-5">
          <header>
            <h2 className="font-semibold text-base tracking-tight">Passkeys</h2>
            <p className="text-muted-foreground text-sm mt-1">
              Sign in with Face ID, Touch ID, or a security key — phishing-resistant,
              no code to type.
            </p>
          </header>
          <PasskeysCard />
        </section>
      )}

      <section className="flex flex-col gap-5">
        <header>
          <h2 className="font-semibold text-base tracking-tight">Connected accounts</h2>
          <p className="text-muted-foreground text-sm mt-1">
            Third-party logins linked to your account.
          </p>
        </header>
        <ConnectedAccountsCard />
      </section>

      <section className="flex flex-col gap-5">
        <header className="flex items-end justify-between gap-3">
          <div>
            <h2 className="font-semibold text-base tracking-tight">
              Active sessions
            </h2>
            <p className="text-muted-foreground text-sm mt-1">
              Devices currently signed in to your account.
            </p>
          </div>
          {hasOthers && (
            <Button
              variant="outline"
              size="sm"
              onClick={revokeOthers}
              disabled={busy === "others"}
            >
              {busy === "others" && <Loader2 size={13} className="animate-spin" />}
              Sign out other sessions
            </Button>
          )}
        </header>

        {sessions === null ? (
          <FormSkeleton />
        ) : sessions.length === 0 ? (
          <Card className="px-5 py-6 text-dense text-muted-foreground">
            No active sessions found.
          </Card>
        ) : (
          <Card className="divide-y divide-border overflow-hidden">
            {sessions.map((s) => {
              const current = s.token === currentToken;
              return (
                <div key={s.id} className="flex items-center gap-3 px-5 py-3.5">
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-md border border-border bg-background text-muted-foreground">
                    <Monitor size={14} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 text-dense font-medium">
                      {deviceLabel(s.userAgent)}
                      {current && (
                        <span className="inline-flex items-center gap-1.5 font-mono text-meta text-positive">
                          <span className="size-2 rounded-full bg-positive" />
                          This device
                        </span>
                      )}
                    </div>
                    <div className="text-meta text-muted-foreground font-mono" data-ph-mask>
                      {[s.ipAddress, `Signed in ${formatDistanceToNow(new Date(s.createdAt), { addSuffix: true })}`]
                        .filter(Boolean)
                        .join(" · ")}
                    </div>
                  </div>
                  {!current && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => revokeOne(s.token)}
                      disabled={busy === s.token}
                    >
                      {busy === s.token && <Loader2 size={13} className="animate-spin" />}
                      Sign out
                    </Button>
                  )}
                </div>
              );
            })}
          </Card>
        )}
      </section>
    </div>
  );
}
