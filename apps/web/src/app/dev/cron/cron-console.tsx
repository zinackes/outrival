"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2, Play, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

// DEV-ONLY companion to page.tsx — see that file's header.

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";
const TRIGGER_DASHBOARD = "https://cloud.trigger.dev";

interface Cron {
  id: string;
  label: string;
  cron: string;
  scope: "global" | "per-org";
  description: string;
}

interface RunState {
  runId: string;
  status: string;
  isCompleted: boolean;
  isSuccess?: boolean;
  isFailed?: boolean;
  durationMs?: number;
  output?: unknown;
  error?: unknown;
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    credentials: "include",
    cache: "no-store",
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    ...init,
  });
  if (!res.ok) throw new Error(`API ${res.status}`);
  return res.json() as Promise<T>;
}

const PENDING = new Set(["TRIGGERING", "QUEUED", "DEQUEUED", "EXECUTING", "WAITING"]);

function statusVariant(s: RunState): "default" | "secondary" | "destructive" {
  if (s.isFailed || s.status === "TRIGGER_FAILED") return "destructive";
  if (s.isSuccess) return "default";
  return "secondary";
}

export function CronConsole() {
  const [crons, setCrons] = useState<Cron[]>([]);
  const [runs, setRuns] = useState<Record<string, RunState>>({});
  const [loadErr, setLoadErr] = useState<string | null>(null);

  useEffect(() => {
    api<{ crons: Cron[] }>("/api/dev/crons")
      .then((d) => setCrons(d.crons))
      .catch((e) => setLoadErr(String(e)));
  }, []);

  function poll(id: string, runId: string) {
    const tick = async () => {
      try {
        const run = await api<Omit<RunState, "runId">>(`/api/dev/runs/${runId}`);
        setRuns((r) => ({ ...r, [id]: { ...run, runId } }));
        if (!run.isCompleted) setTimeout(tick, 1500);
      } catch {
        // Transient (run not yet visible / API blip) — keep polling, slower.
        setTimeout(tick, 2500);
      }
    };
    setTimeout(tick, 1000);
  }

  async function run(id: string) {
    setRuns((r) => ({
      ...r,
      [id]: { runId: "", status: "TRIGGERING", isCompleted: false },
    }));
    try {
      const { runId } = await api<{ runId: string }>(
        `/api/dev/crons/${id}/trigger`,
        { method: "POST" },
      );
      setRuns((r) => ({ ...r, [id]: { runId, status: "QUEUED", isCompleted: false } }));
      poll(id, runId);
    } catch (e) {
      toast.error(`Failed to trigger ${id}`);
      setRuns((r) => ({
        ...r,
        [id]: {
          runId: "",
          status: "TRIGGER_FAILED",
          isCompleted: true,
          isFailed: true,
          error: String(e),
        },
      }));
    }
  }

  return (
    <div className="mx-auto max-w-3xl px-6 py-10">
      <div className="mb-8">
        <div className="flex items-center gap-3">
          <h1 className="font-[var(--font-syne)] text-2xl font-bold">
            Cron console
          </h1>
          <Badge variant="outline">dev only</Badge>
        </div>
        <p className="mt-2 text-sm text-muted-foreground">
          Fire any scheduled job on demand and watch its run resolve inline.
          Backend is unmounted in production. Per-org jobs carry skip guards, so
          a run may complete with a no-op result.
        </p>
      </div>

      {loadErr && (
        <p className="mb-6 text-sm text-destructive">
          Could not reach the dev API ({loadErr}). Is the API running on{" "}
          <code>{API}</code> and are you signed in?
        </p>
      )}

      <div className="space-y-4">
        {crons.map((cron) => {
          const state = runs[cron.id];
          const pending = state ? PENDING.has(state.status) && !state.isCompleted : false;

          return (
            <Card key={cron.id}>
              <CardHeader>
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <CardTitle className="flex items-center gap-2 text-base">
                      {cron.label}
                      <Badge variant={cron.scope === "global" ? "secondary" : "outline"}>
                        {cron.scope}
                      </Badge>
                    </CardTitle>
                    <CardDescription className="mt-1">
                      {cron.description}
                    </CardDescription>
                    <code className="mt-2 inline-block text-xs text-muted-foreground">
                      {cron.id} · {cron.cron}
                    </code>
                  </div>
                  <Button size="sm" disabled={pending} onClick={() => run(cron.id)}>
                    {pending ? (
                      <Loader2 className="animate-spin" />
                    ) : (
                      <Play />
                    )}
                    Run
                  </Button>
                </div>
              </CardHeader>

              {state && (
                <CardContent className="border-t pt-4">
                  <div className="flex items-center gap-2 text-sm">
                    <Badge variant={statusVariant(state)}>{state.status}</Badge>
                    {typeof state.durationMs === "number" && state.durationMs > 0 && (
                      <span className="text-xs text-muted-foreground">
                        {state.durationMs} ms
                      </span>
                    )}
                    {state.runId && (
                      <a
                        href={TRIGGER_DASHBOARD}
                        target="_blank"
                        rel="noreferrer"
                        className="ml-auto inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                      >
                        {state.runId} <ExternalLink className="size-3" />
                      </a>
                    )}
                  </div>

                  {state.isCompleted && state.output != null && (
                    <pre className="mt-3 overflow-x-auto rounded-md bg-muted p-3 text-xs">
                      {JSON.stringify(state.output, null, 2)}
                    </pre>
                  )}
                  {(state.isFailed || state.status === "TRIGGER_FAILED") && state.error != null && (
                    <pre className="mt-3 overflow-x-auto rounded-md bg-destructive/10 p-3 text-xs text-destructive">
                      {typeof state.error === "string"
                        ? state.error
                        : JSON.stringify(state.error, null, 2)}
                    </pre>
                  )}
                </CardContent>
              )}
            </Card>
          );
        })}
      </div>
    </div>
  );
}
