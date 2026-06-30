"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { Copy, Download, Fingerprint, KeyRound, Link2, Loader2, Monitor, ShieldCheck } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";
import { useSession, authClient } from "@/lib/auth-client";
import { api, ApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { FormSkeleton } from "@/components/dashboard/skeletons";
import { ReauthCodeField } from "@/components/outrival/reauth-code-field";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "";
const PASSKEYS_ENABLED = process.env.NEXT_PUBLIC_PASSKEYS_ENABLED === "true";

const PROVIDER_LABELS: Record<string, string> = {
  google: "Google",
  credential: "Email & password",
};

interface SessionRow {
  id: string;
  token: string;
  userAgent: string | null;
  ipAddress: string | null;
  createdAt: string;
}

interface PasskeyRow {
  id: string;
  name?: string | null;
  createdAt?: string | null;
}

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

// One presentational row for the unified "sign-in methods" list — icon tile,
// title + status line, and a right-aligned slot for a badge and/or action.
function MethodRow({
  icon,
  title,
  description,
  children,
}: {
  icon: ReactNode;
  title: string;
  description: string;
  children?: ReactNode;
}) {
  return (
    <div className="flex items-center gap-3 px-5 py-4">
      <span className="flex size-9 shrink-0 items-center justify-center rounded-md border border-border bg-background text-muted-foreground">
        {icon}
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium text-foreground">{title}</div>
        <div className="text-dense text-muted-foreground">{description}</div>
      </div>
      {children && <div className="flex shrink-0 items-center gap-2">{children}</div>}
    </div>
  );
}

// Reveal-once recovery codes: shown at enrollment and again after regeneration.
// Both moments hand the user a one-time set to store, so the copy/download/ack
// affordances are identical.
function RecoveryCodes({
  codes,
  ack,
  onAck,
}: {
  codes: string[];
  ack: boolean;
  onAck: (v: boolean) => void;
}) {
  async function copy() {
    try {
      await navigator.clipboard.writeText(codes.join("\n"));
      toast.success("Recovery codes copied.");
    } catch {
      toast.error("Couldn't copy — select the codes and copy them by hand.");
    }
  }

  function download() {
    const text =
      "Outrival — two-factor recovery codes\n" +
      "Each code works once if you lose your authenticator app.\n\n" +
      codes.join("\n") +
      "\n";
    const url = URL.createObjectURL(new Blob([text], { type: "text/plain" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "outrival-recovery-codes.txt";
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-1.5 rounded-md border border-border bg-background p-3">
        {codes.map((c) => (
          <code key={c} className="select-all font-mono text-dense text-foreground">
            {c}
          </code>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" size="sm" onClick={copy}>
          <Copy size={13} />
          Copy
        </Button>
        <Button variant="outline" size="sm" onClick={download}>
          <Download size={13} />
          Download
        </Button>
      </div>
      <label className="flex items-center gap-2 text-dense text-foreground">
        <Checkbox checked={ack} onCheckedChange={(v) => onAck(v === true)} />
        I&apos;ve saved these recovery codes
      </label>
    </div>
  );
}

type TwoFactorSetup = {
  totpURI: string;
  secret: string | null;
  backupCodes: string[];
};
type SetupStep = "scan" | "verify" | "backup";

// Authenticator-app 2FA, housed in a dialog (the 2026 settings convention: the
// list stays calm, the multi-step flow runs in a modal). Enabling is verify-first
// — we fetch a secret + recovery codes, the user scans then confirms a TOTP code,
// and only then is 2FA switched on server-side, so an abandoned setup never locks
// anyone out. When already on, the dialog manages the method: regenerate recovery
// codes (gated by an emailed step-up code) or turn it off. Sign-in enforcement
// (incl. the email-code & Google paths) lives in the API auth hook.
function TwoFactorDialog({
  open,
  onOpenChange,
  enabled,
  onEnabledChange,
  onDone,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  enabled: boolean;
  onEnabledChange: (v: boolean) => void;
  onDone: () => void;
}) {
  // Enrollment
  const [setup, setSetup] = useState<TwoFactorSetup | null>(null);
  const [step, setStep] = useState<SetupStep>("scan");
  const [code, setCode] = useState("");
  const [enrollAck, setEnrollAck] = useState(false);
  const startedRef = useRef(false);
  // Manage → regenerate recovery codes
  const [regenOpen, setRegenOpen] = useState(false);
  const [regenCode, setRegenCode] = useState("");
  const [newCodes, setNewCodes] = useState<string[] | null>(null);
  const [regenAck, setRegenAck] = useState(false);
  // Shared
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const reset = useCallback(() => {
    setSetup(null);
    setStep("scan");
    setCode("");
    setEnrollAck(false);
    setRegenOpen(false);
    setRegenCode("");
    setNewCodes(null);
    setRegenAck(false);
    setBusy(false);
    setError("");
    startedRef.current = false;
  }, []);

  const startEnable = useCallback(async () => {
    if (startedRef.current) return; // dedupe (React strict-mode double-invoke)
    startedRef.current = true;
    setBusy(true);
    setError("");
    try {
      const data = await twoFactorRequest<{ totpURI: string; backupCodes?: string[] }>("enable");
      setSetup({
        totpURI: data.totpURI,
        secret: secretFromUri(data.totpURI),
        backupCodes: data.backupCodes ?? [],
      });
      setStep("scan");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't start 2FA setup.");
      startedRef.current = false;
    } finally {
      setBusy(false);
    }
  }, []);

  // Kick off enrollment when the dialog opens for a user without 2FA; clear all
  // state when it closes so the next open starts fresh.
  useEffect(() => {
    if (!open) {
      reset();
      return;
    }
    if (!enabled) void startEnable();
  }, [open, enabled, startEnable, reset]);

  // verify-totp flips 2FA on server-side; we then reveal the recovery codes.
  async function confirmCode() {
    if (code.length < 6) return;
    setBusy(true);
    setError("");
    try {
      await twoFactorRequest("verify-totp", { code });
      onEnabledChange(true);
      setStep("backup");
      toast.success("Two-factor authentication is on.");
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
      onEnabledChange(false);
      toast.success("Two-factor authentication is off.");
      onOpenChange(false);
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't disable 2FA.");
    } finally {
      setBusy(false);
    }
  }

  async function regenerate() {
    setBusy(true);
    setError("");
    try {
      const res = await api.regenerateBackupCodes({ code: regenCode });
      setNewCodes(res.backupCodes);
      toast.success("New recovery codes generated — the old ones no longer work.");
    } catch (e) {
      setError(
        e instanceof ApiError && typeof e.data.message === "string"
          ? e.data.message
          : "Couldn't regenerate the recovery codes.",
      );
    } finally {
      setBusy(false);
    }
  }

  // ── Enrollment view (a setup is in flight) ───────────────────────────────
  function renderEnroll(s: TwoFactorSetup) {
    const stepNumber = step === "scan" ? 1 : step === "verify" ? 2 : 3;
    return (
      <>
        <DialogHeader>
          <DialogDescription className="text-meta uppercase tracking-wide">
            Step {stepNumber} of 3
          </DialogDescription>
          <DialogTitle>
            {step === "scan"
              ? "Scan with your authenticator app"
              : step === "verify"
                ? "Enter the 6-digit code"
                : "Save your recovery codes"}
          </DialogTitle>
          <DialogDescription>
            {step === "scan"
              ? "Use Google Authenticator, 1Password, Authy, or similar — scan the code or enter the key by hand."
              : step === "verify"
                ? "Open your authenticator app and type the current code to confirm the setup."
                : "Each code works once if you lose your device. Store them somewhere safe — they won't be shown again."}
          </DialogDescription>
        </DialogHeader>

        {step === "scan" && (
          <>
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
              {/* QR needs a light tile in both themes to stay scannable. */}
              <div className="w-fit rounded-lg bg-white p-3">
                <QRCodeSVG value={s.totpURI} size={148} />
              </div>
              {s.secret && (
                <div className="flex flex-1 flex-col gap-1">
                  <span className="text-meta text-muted-foreground">Or enter this key manually</span>
                  <code className="select-all break-all rounded-md border border-border bg-background px-2.5 py-1.5 font-mono text-dense text-foreground">
                    {s.secret}
                  </code>
                </div>
              )}
            </div>
            {error && (
              <p className="text-dense text-destructive" role="alert">
                {error}
              </p>
            )}
            <DialogFooter>
              <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)} disabled={busy}>
                Cancel
              </Button>
              <Button
                size="sm"
                onClick={() => {
                  setStep("verify");
                  setError("");
                }}
              >
                Continue
              </Button>
            </DialogFooter>
          </>
        )}

        {step === "verify" && (
          <>
            <div className="flex flex-col gap-2 sm:max-w-xs">
              <Label htmlFor="totp-confirm" className="text-dense">
                6-digit code
              </Label>
              <Input
                id="totp-confirm"
                inputMode="numeric"
                autoComplete="one-time-code"
                autoFocus
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
            <DialogFooter>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setStep("scan");
                  setCode("");
                  setError("");
                }}
                disabled={busy}
              >
                Back
              </Button>
              <Button size="sm" onClick={confirmCode} disabled={busy || code.length < 6}>
                {busy && <Loader2 size={13} className="animate-spin" />}
                Verify and continue
              </Button>
            </DialogFooter>
          </>
        )}

        {step === "backup" && (
          <>
            {s.backupCodes.length > 0 && (
              <RecoveryCodes codes={s.backupCodes} ack={enrollAck} onAck={setEnrollAck} />
            )}
            <DialogFooter>
              <Button
                size="sm"
                disabled={!enrollAck}
                onClick={() => {
                  onOpenChange(false);
                  onDone();
                }}
              >
                Done
              </Button>
            </DialogFooter>
          </>
        )}
      </>
    );
  }

  // ── Manage view (already enabled) ────────────────────────────────────────
  function renderManage() {
    return (
      <>
        <DialogHeader>
          <DialogTitle>Two-factor authentication</DialogTitle>
          <DialogDescription>
            Your account is protected by an authenticator app on every sign-in.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3 rounded-md border border-border p-4">
          <div>
            <div className="text-sm font-medium text-foreground">Recovery codes</div>
            <p className="text-dense text-muted-foreground">
              Use one to sign in if you lose your authenticator app. Generating a new set
              replaces the old one.
            </p>
          </div>

          {newCodes ? (
            <>
              <RecoveryCodes codes={newCodes} ack={regenAck} onAck={setRegenAck} />
              <div>
                <Button
                  size="sm"
                  disabled={!regenAck}
                  onClick={() => {
                    setRegenOpen(false);
                    setNewCodes(null);
                    setRegenAck(false);
                    setRegenCode("");
                  }}
                >
                  Done
                </Button>
              </div>
            </>
          ) : regenOpen ? (
            <div className="flex flex-col gap-3">
              <p className="text-dense text-muted-foreground">
                We email a confirmation code before generating new recovery codes.
              </p>
              <ReauthCodeField code={regenCode} onCode={setRegenCode} />
              {error && (
                <p className="text-dense text-destructive" role="alert">
                  {error}
                </p>
              )}
              <div className="flex items-center gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setRegenOpen(false);
                    setRegenCode("");
                    setError("");
                  }}
                  disabled={busy}
                >
                  Cancel
                </Button>
                <Button size="sm" onClick={regenerate} disabled={busy || regenCode.length !== 6}>
                  {busy && <Loader2 size={13} className="animate-spin" />}
                  Generate new codes
                </Button>
              </div>
            </div>
          ) : (
            <div>
              <Button variant="outline" size="sm" onClick={() => setRegenOpen(true)}>
                Regenerate recovery codes
              </Button>
            </div>
          )}
        </div>

        {error && !regenOpen && (
          <p className="text-dense text-destructive" role="alert">
            {error}
          </p>
        )}

        <DialogFooter className="sm:justify-between">
          <Button
            variant="outline"
            size="sm"
            className="text-destructive border-destructive/25"
            onClick={disable}
            disabled={busy}
          >
            {busy && !regenOpen && <Loader2 size={13} className="animate-spin" />}
            Turn off two-factor
          </Button>
          <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)} disabled={busy}>
            Close
          </Button>
        </DialogFooter>
      </>
    );
  }

  // ── Starting / loading the enrollment secret ─────────────────────────────
  function renderStarting() {
    return (
      <>
        <DialogHeader>
          <DialogTitle>Set up two-factor authentication</DialogTitle>
          <DialogDescription>Preparing your setup…</DialogDescription>
        </DialogHeader>
        {error ? (
          <>
            <p className="text-dense text-destructive" role="alert">
              {error}
            </p>
            <DialogFooter>
              <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button size="sm" onClick={startEnable}>
                Try again
              </Button>
            </DialogFooter>
          </>
        ) : (
          <div className="flex items-center gap-2 py-4 text-dense text-muted-foreground">
            <Loader2 size={14} className="animate-spin" />
            One moment…
          </div>
        )}
      </>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        {setup ? renderEnroll(setup) : enabled ? renderManage() : renderStarting()}
      </DialogContent>
    </Dialog>
  );
}

function TwoFactorRow({ initialEnabled }: { initialEnabled: boolean }) {
  const router = useRouter();
  const [enabled, setEnabled] = useState(initialEnabled);
  const [open, setOpen] = useState(false);

  return (
    <>
      <MethodRow
        icon={<ShieldCheck size={16} />}
        title="Authenticator app"
        description={
          enabled
            ? "A one-time code is required on every sign-in."
            : "Add a one-time code to every sign-in — email code, Google, and password alike."
        }
      >
        {enabled ? (
          <Badge variant="tracked">On</Badge>
        ) : (
          <Badge variant="paused">Off</Badge>
        )}
        <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
          {enabled ? "Manage" : "Set up"}
        </Button>
      </MethodRow>
      <TwoFactorDialog
        open={open}
        onOpenChange={setOpen}
        enabled={enabled}
        onEnabledChange={setEnabled}
        onDone={() => router.refresh()}
      />
    </>
  );
}

// Passkeys (WebAuthn) — register/list/remove device-bound credentials in a
// dialog. Adding runs a browser ceremony (authClient.passkey.addPasskey); listing
// and removal hit the plugin routes directly. The whole method is gated behind
// NEXT_PUBLIC_PASSKEYS_ENABLED until verified on staging with a real device.
function PasskeysDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const passkeysQ = useQuery({
    queryKey: ["passkeys"],
    queryFn: () =>
      fetch(`${API_URL}/api/auth/passkey/list-user-passkeys`, { credentials: "include" })
        .then((r) => (r.ok ? r.json() : []))
        .then((rows) => (Array.isArray(rows) ? (rows as PasskeyRow[]) : [])),
  });
  const passkeys: PasskeyRow[] | null = passkeysQ.data ?? null;
  const [busy, setBusy] = useState<string | null>(null);

  function load() {
    return queryClient.invalidateQueries({ queryKey: ["passkeys"] });
  }

  async function add() {
    setBusy("add");
    try {
      const res = await authClient.passkey.addPasskey();
      if (res?.error) {
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
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Passkeys</DialogTitle>
          <DialogDescription>
            Sign in with Face ID, Touch ID, or a security key — phishing-resistant, no code to type.
          </DialogDescription>
        </DialogHeader>

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

        <DialogFooter className="sm:justify-between">
          <Button variant="outline" size="sm" onClick={add} disabled={busy === "add"}>
            {busy === "add" && <Loader2 size={13} className="animate-spin" />}
            Add a passkey
          </Button>
          <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PasskeysRow() {
  const [open, setOpen] = useState(false);
  const passkeysQ = useQuery({
    queryKey: ["passkeys"],
    queryFn: () =>
      fetch(`${API_URL}/api/auth/passkey/list-user-passkeys`, { credentials: "include" })
        .then((r) => (r.ok ? r.json() : []))
        .then((rows) => (Array.isArray(rows) ? (rows as PasskeyRow[]) : [])),
  });
  const count = passkeysQ.data?.length ?? 0;

  return (
    <>
      <MethodRow
        icon={<Fingerprint size={16} />}
        title="Passkeys"
        description={
          count > 0
            ? "Face ID, Touch ID, or a security key — no code to type."
            : "Sign in with Face ID, Touch ID, or a security key."
        }
      >
        {count > 0 && <Badge variant="tracked">{count}</Badge>}
        <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
          Manage
        </Button>
      </MethodRow>
      <PasskeysDialog open={open} onOpenChange={setOpen} />
    </>
  );
}

// Linked OAuth providers (e.g. Google), rendered as rows in the same list.
// Disconnecting never locks anyone out — email-code sign-in always works.
function ConnectedAccountRows() {
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

  if (accounts === null) {
    return (
      <div className="flex items-center gap-3 px-5 py-4 text-dense text-muted-foreground">
        Loading connected accounts…
      </div>
    );
  }

  const social = accounts.filter((a) => a.providerId !== "credential");

  if (social.length === 0) {
    return (
      <MethodRow
        icon={<Link2 size={16} />}
        title="Third-party logins"
        description="No third-party accounts connected. You can always sign in with an email code."
      />
    );
  }

  return (
    <>
      {social.map((a) => (
        <MethodRow
          key={a.providerId}
          icon={<Link2 size={16} />}
          title={PROVIDER_LABELS[a.providerId] ?? a.providerId}
          description="Connected — use it to sign in."
        >
          <Button
            variant="ghost"
            size="sm"
            onClick={() => disconnect(a.providerId)}
            disabled={busy === a.providerId}
          >
            {busy === a.providerId && <Loader2 size={13} className="animate-spin" />}
            Disconnect
          </Button>
        </MethodRow>
      ))}
    </>
  );
}

function SignInMethods({ twoFactorEnabled }: { twoFactorEnabled: boolean }) {
  return (
    <section className="flex flex-col gap-5">
      <header>
        <h2 className="font-semibold text-base tracking-tight">Sign-in &amp; security</h2>
        <p className="text-muted-foreground text-sm mt-1">
          How you sign in, and the extra checks that protect your account.
        </p>
      </header>
      <Card className="divide-y divide-border overflow-hidden">
        <TwoFactorRow initialEnabled={twoFactorEnabled} />
        {PASSKEYS_ENABLED && <PasskeysRow />}
        <ConnectedAccountRows />
      </Card>
    </section>
  );
}

// Password as a sign-in method (alongside email codes, Google, passkeys).
// Magic-link / Google accounts have no credential account, so they SET a first
// password (no current one to ask for); accounts that already have one CHANGE it
// — current password required, other sessions revoked server-side. The flow runs
// in a two-step dialog (mirroring 2FA): choose the password, then confirm with an
// emailed code — a step-up so a hijacked session alone can't plant a credential.
function PasswordDialog({
  open,
  onOpenChange,
  hasPassword,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  hasPassword: boolean;
}) {
  const queryClient = useQueryClient();
  const [step, setStep] = useState<"choose" | "confirm">("choose");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const reset = useCallback(() => {
    setStep("choose");
    setCurrentPassword("");
    setNewPassword("");
    setCode("");
    setBusy(false);
    setError("");
  }, []);

  // Clear all state when the dialog closes so the next open starts fresh.
  useEffect(() => {
    if (!open) reset();
  }, [open, reset]);

  // Step 1 → email a confirmation code, then reveal the code field.
  async function sendCode() {
    setBusy(true);
    setError("");
    try {
      await api.sendReauthCode("password");
      setStep("confirm");
    } catch {
      setError("Couldn't email the confirmation code. Try again.");
    } finally {
      setBusy(false);
    }
  }

  async function resend() {
    setBusy(true);
    setError("");
    try {
      await api.sendReauthCode("password");
      toast.success("New code sent.");
    } catch {
      setError("Couldn't resend the code. Try again.");
    } finally {
      setBusy(false);
    }
  }

  async function submit() {
    setBusy(true);
    setError("");
    try {
      const r = await api.setPassword({
        newPassword,
        code,
        ...(hasPassword ? { currentPassword } : {}),
      });
      void queryClient.invalidateQueries({ queryKey: ["authAccounts"] });
      // Changing a password revokes other sessions server-side — refresh the list.
      if (r.changed) void queryClient.invalidateQueries({ queryKey: ["authSessions"] });
      toast.success(
        r.changed ? "Password changed — other sessions signed out." : "Password set.",
      );
      onOpenChange(false);
    } catch (e) {
      setError(
        e instanceof ApiError && typeof e.data.message === "string"
          ? e.data.message
          : "Couldn't update the password.",
      );
    } finally {
      setBusy(false);
    }
  }

  const canContinue =
    newPassword.length >= 12 && (!hasPassword || currentPassword.length > 0);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogDescription className="text-meta uppercase tracking-wide">
            Step {step === "choose" ? 1 : 2} of 2
          </DialogDescription>
          <DialogTitle>
            {step === "choose"
              ? hasPassword
                ? "Change your password"
                : "Set a password"
              : "Confirm it's you"}
          </DialogTitle>
          <DialogDescription>
            {step === "choose"
              ? "We'll email a 6-digit code to confirm before it's saved."
              : "Enter the code we just emailed you to finish."}
          </DialogDescription>
        </DialogHeader>

        {step === "choose" ? (
          <>
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
            </div>
            {error && (
              <p className="text-dense text-destructive" role="alert">
                {error}
              </p>
            )}
            <DialogFooter>
              <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)} disabled={busy}>
                Cancel
              </Button>
              <Button size="sm" onClick={sendCode} disabled={busy || !canContinue}>
                {busy && <Loader2 size={13} className="animate-spin" />}
                Continue
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <div className="flex flex-col gap-1.5 sm:max-w-xs">
              <Label htmlFor="pw-code" className="text-dense">
                Confirmation code
              </Label>
              <Input
                id="pw-code"
                inputMode="numeric"
                autoComplete="one-time-code"
                autoFocus
                maxLength={6}
                placeholder="123456"
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                className="font-mono tracking-[0.3em]"
              />
              <button
                type="button"
                onClick={resend}
                disabled={busy}
                className="w-fit text-meta text-muted-foreground transition-colors hover:text-foreground"
              >
                Resend code
              </button>
            </div>
            {error && (
              <p className="text-dense text-destructive" role="alert">
                {error}
              </p>
            )}
            <DialogFooter>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setStep("choose");
                  setCode("");
                  setError("");
                }}
                disabled={busy}
              >
                Back
              </Button>
              <Button size="sm" onClick={submit} disabled={busy || code.length !== 6}>
                {busy && <Loader2 size={13} className="animate-spin" />}
                {hasPassword ? "Change password" : "Set password"}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function PasswordSection() {
  const accountsQ = useQuery({
    queryKey: ["authAccounts"],
    queryFn: () => authClient.listAccounts().then((res) => res.data ?? []),
  });
  const hasPassword = accountsQ.isError
    ? false
    : accountsQ.data
      ? accountsQ.data.some((a) => a.providerId === "credential")
      : null;

  const [open, setOpen] = useState(false);

  return (
    <section className="flex flex-col gap-5">
      <header>
        <h2 className="font-semibold text-base tracking-tight">Password</h2>
        <p className="text-muted-foreground text-sm mt-1">
          Another way to sign in, alongside email codes and Google.
        </p>
      </header>
      <Card className="px-5 py-4">
        <div className="flex items-center gap-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-md border border-border bg-background text-muted-foreground">
            <KeyRound size={16} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium text-foreground">
              {hasPassword === null ? "Checking…" : hasPassword ? "Password set" : "No password"}
            </div>
            <div className="text-dense text-muted-foreground">
              {hasPassword
                ? "You can sign in with your password."
                : "Set one to sign in without an email code."}
            </div>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setOpen(true)}
            disabled={hasPassword === null}
          >
            {hasPassword ? "Change" : "Set password"}
          </Button>
        </div>
      </Card>
      {hasPassword !== null && (
        <PasswordDialog open={open} onOpenChange={setOpen} hasPassword={hasPassword} />
      )}
    </section>
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

function ActiveSessions() {
  const queryClient = useQueryClient();
  const { data: session } = useSession();
  const currentToken = session?.session?.token;
  const [busy, setBusy] = useState<string | null>(null);

  const sessionsQ = useQuery({
    queryKey: ["authSessions"],
    queryFn: () =>
      authClient.listSessions().then((res) =>
        (res.data ?? []).map(
          (s): SessionRow => ({
            id: s.id,
            token: s.token,
            userAgent: s.userAgent ?? null,
            ipAddress: s.ipAddress ?? null,
            createdAt: new Date(s.createdAt).toISOString(),
          }),
        ),
      ),
  });
  const sessions: SessionRow[] | null = sessionsQ.isError ? [] : (sessionsQ.data ?? null);

  function reload() {
    return queryClient.invalidateQueries({ queryKey: ["authSessions"] });
  }

  async function revokeOne(token: string) {
    setBusy(token);
    try {
      await authClient.revokeSession({ token });
      toast.success("Session signed out");
      reload();
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
      reload();
    } catch {
      toast.error("Could not sign out other sessions");
    } finally {
      setBusy(null);
    }
  }

  const hasOthers = !!sessions && sessions.some((s) => s.token !== currentToken);

  return (
    <section className="flex flex-col gap-5">
      <header className="flex items-end justify-between gap-3">
        <div>
          <h2 className="font-semibold text-base tracking-tight">Active sessions</h2>
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
  );
}

export function SecuritySettings() {
  const { data: session } = useSession();
  // twoFactorEnabled isn't in the base client's user type (no client plugin), so
  // read it off the returned session object.
  const twoFactorEnabled = Boolean(
    (session?.user as { twoFactorEnabled?: boolean } | undefined)?.twoFactorEnabled,
  );

  return (
    <div className="flex flex-col gap-10">
      <SignInMethods key={String(twoFactorEnabled)} twoFactorEnabled={twoFactorEnabled} />
      <ActiveSessions />
      <PasswordSection />
    </div>
  );
}
