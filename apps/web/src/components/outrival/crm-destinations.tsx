"use client";

import { useEffect, useState } from "react";
import { Webhook, Trash2, Send, Plus, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { api, ApiError, type CrmDestination } from "@/lib/api";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function CrmDestinations() {
  const [list, setList] = useState<CrmDestination[] | null>(null);
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [secret, setSecret] = useState("");
  const [adding, setAdding] = useState(false);
  const [locked, setLocked] = useState(false);
  const [testingId, setTestingId] = useState<string | null>(null);

  function refresh() {
    api
      .listCrmDestinations()
      .then((r) => setList(r.destinations))
      .catch(() => setList([]));
  }
  useEffect(() => {
    refresh();
  }, []);

  async function add() {
    if (!name.trim() || !url.trim()) return;
    setAdding(true);
    try {
      const r = await api.createCrmDestination(name.trim(), url.trim(), secret.trim() || undefined);
      setList((p) => (p ? [r.destination, ...p] : [r.destination]));
      setName("");
      setUrl("");
      setSecret("");
    } catch (e) {
      if (e instanceof ApiError && e.code === "plan_locked_feature") {
        setLocked(true);
        toast.error("CRM webhooks are a Business feature.");
      } else if (e instanceof ApiError && e.code === "invalid_url") {
        toast.error("Enter a valid https:// URL (no private hosts).");
      } else {
        toast.error("Couldn't add the destination.");
      }
    } finally {
      setAdding(false);
    }
  }

  async function remove(id: string) {
    setList((p) => (p ? p.filter((d) => d.id !== id) : p));
    await api.deleteCrmDestination(id).catch(() => {});
  }

  async function test(id: string) {
    setTestingId(id);
    try {
      const r = await api.testCrmDestination(id);
      if (r.ok) toast.success("Test push delivered.");
      else toast.error("Destination didn't accept the test (non-2xx).");
    } catch {
      toast.error("Test failed.");
    } finally {
      setTestingId(null);
    }
  }

  return (
    <section className="flex flex-col gap-3">
      <div>
        <h3 className="text-dense font-semibold tracking-tight">CRM &amp; webhooks</h3>
        <p className="text-muted-foreground mt-0.5 text-xs">
          Push every alerted signal to a URL — Zapier, Make, n8n or your CRM. Signed with
          <span className="font-mono"> X-Outrival-Signature</span> when a secret is set.
        </p>
      </div>

      {locked && (
        <div className="text-muted-foreground rounded-md border border-dashed border-border px-3 py-2 text-xs">
          Outbound webhooks are available on the{" "}
          <span className="text-foreground font-medium">Business</span> plan.
        </div>
      )}

      {list && list.length > 0 && (
        <Card className="divide-y divide-border overflow-hidden">
          {list.map((d) => (
            <div key={d.id} className="flex items-center gap-3 px-4 py-3">
              <Webhook size={14} className="text-muted-foreground shrink-0" aria-hidden />
              <div className="min-w-0 flex-1">
                <div className="text-dense font-medium">{d.name}</div>
                <div className="text-muted-foreground truncate font-mono text-meta">
                  {d.url.replace(/^https?:\/\//, "")}
                  {d.hasSecret ? " · signed" : ""}
                </div>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => test(d.id)}
                disabled={testingId === d.id}
              >
                {testingId === d.id ? (
                  <Loader2 size={12} className="animate-spin" />
                ) : (
                  <Send size={12} />
                )}
                Test
              </Button>
              <Button
                variant="ghost"
                size="icon-xs"
                aria-label="Delete destination"
                onClick={() => remove(d.id)}
                className="text-muted-foreground"
              >
                <Trash2 size={13} />
              </Button>
            </div>
          ))}
        </Card>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Input
          placeholder="Name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="h-8 w-32 text-dense"
        />
        <Input
          placeholder="https://…"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          className="h-8 min-w-[180px] flex-1 text-dense"
        />
        <Input
          placeholder="Secret (optional)"
          value={secret}
          onChange={(e) => setSecret(e.target.value)}
          className="h-8 w-40 text-dense"
        />
        <Button size="sm" onClick={add} disabled={adding || !name.trim() || !url.trim()}>
          <Plus size={13} /> Add
        </Button>
      </div>
    </section>
  );
}
