"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Monitor, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";
import { useSession, authClient } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { FormSkeleton } from "@/components/dashboard/skeletons";

interface SessionRow {
  id: string;
  token: string;
  userAgent: string | null;
  ipAddress: string | null;
  createdAt: string;
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
      <section className="flex flex-col gap-5">
        <header>
          <h2 className="font-semibold text-base tracking-tight">
            Two-factor authentication
          </h2>
          <p className="text-muted-foreground text-sm mt-1">
            Add a second step at sign-in for extra protection.
          </p>
        </header>
        <Card className="flex items-center gap-3 px-5 py-4">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-md border border-border bg-background text-muted-foreground">
            <ShieldCheck size={16} />
          </span>
          <div className="flex-1">
            <div className="text-[13px] font-medium">Authenticator app</div>
            <div className="text-[12px] text-muted-foreground/80 font-mono">
              Status: disabled
            </div>
          </div>
          <Button variant="outline" size="sm" disabled>
            Enable 2FA
          </Button>
        </Card>
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
          <Card className="px-5 py-6 text-[13px] text-muted-foreground">
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
                    <div className="flex items-center gap-2 text-[13px] font-medium">
                      {deviceLabel(s.userAgent)}
                      {current && (
                        <span className="inline-flex items-center gap-1.5 font-mono text-[10px] text-positive">
                          <span className="size-[7px] rounded-full bg-positive" />
                          This device
                        </span>
                      )}
                    </div>
                    <div className="text-[11px] text-muted-foreground/80 font-mono" data-ph-mask>
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
