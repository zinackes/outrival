"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  WebhooksLogoIcon,
  TrashIcon,
  PaperPlaneTiltIcon,
  PlusIcon,
  SpinnerIcon,
  PencilIcon,
} from "@/components/icons";
import { toast } from "@/lib/toast";
import { toastApiError } from "@/lib/error-helpers";
import { api, ApiError, type CrmDestination } from "@/lib/api";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { SettingsSection } from "@/components/dashboard/settings-page";
import { EmptyState } from "@/components/dashboard/empty-state";
import { SettingCardRowsSkeleton } from "@/components/dashboard/skeletons";
import { SettingsError } from "@/components/outrival/list-error";

export function CrmDestinations() {
  const queryClient = useQueryClient();
  const listQ = useQuery({
    queryKey: ["crmDestinations"],
    queryFn: () => api.listCrmDestinations().then((r) => r.destinations),
  });
  const list = listQ.data ?? null;
  // Write-through to the cached list for the optimistic add/test/edit/delete updates.
  function setList(
    value:
      | CrmDestination[]
      | ((prev: CrmDestination[] | null) => CrmDestination[] | null),
  ) {
    queryClient.setQueryData<CrmDestination[]>(["crmDestinations"], (prev) =>
      (typeof value === "function" ? value(prev ?? null) : value) ?? [],
    );
  }
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [secret, setSecret] = useState("");
  const [adding, setAdding] = useState(false);
  const [locked, setLocked] = useState(false);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editUrl, setEditUrl] = useState("");
  const [editSecret, setEditSecret] = useState("");
  const [saving, setSaving] = useState(false);
  // URL / server validation shows inline next to the row it belongs to, not in a
  // toast that fades away from the field the user needs to fix.
  const [addError, setAddError] = useState<string | null>(null);
  const [editError, setEditError] = useState<string | null>(null);
  // Deleting a destination silently stops every future push to it, and the secret
  // is not recoverable — an optimistic one-click delete gave no way back.
  const [removeTarget, setRemoveTarget] = useState<CrmDestination | null>(null);

  function refresh() {
    return queryClient.invalidateQueries({ queryKey: ["crmDestinations"] });
  }

  async function add() {
    if (!name.trim() || !url.trim()) return;
    setAdding(true);
    setAddError(null);
    try {
      const r = await api.createCrmDestination(name.trim(), url.trim(), secret.trim() || undefined);
      setList((p) => (p ? [r.destination, ...p] : [r.destination]));
      setName("");
      setUrl("");
      setSecret("");
    } catch (e) {
      if (e instanceof ApiError && e.code === "plan_locked_feature") {
        // The Business-plan notice renders as the inline banner below, so no toast.
        setLocked(true);
      } else if (e instanceof ApiError && e.code === "invalid_url") {
        setAddError("Enter a valid https:// URL (no private hosts).");
      } else {
        setAddError("Couldn't add the destination. Try again.");
      }
    } finally {
      setAdding(false);
    }
  }

  async function remove() {
    const target = removeTarget;
    if (!target) return;
    setRemoveTarget(null);
    setList((p) => (p ? p.filter((d) => d.id !== target.id) : p));
    try {
      await api.deleteCrmDestination(target.id);
      toast.success(`${target.name} removed. Nothing is pushed there anymore.`);
    } catch (e) {
      // The row is already gone from the list, so put it back rather than leave
      // the user believing a destination that still receives pushes is deleted.
      await refresh();
      toastApiError(e, { title: "Couldn't remove the destination" });
    }
  }

  function startEdit(d: CrmDestination) {
    setEditingId(d.id);
    setEditName(d.name);
    setEditUrl(d.url);
    setEditSecret("");
    setEditError(null);
  }

  async function saveEdit() {
    if (!editingId || !editName.trim() || !editUrl.trim()) return;
    setSaving(true);
    setEditError(null);
    try {
      const r = await api.updateCrmDestination(editingId, {
        name: editName.trim(),
        url: editUrl.trim(),
        // Empty input = keep the current secret; typing a value rotates it.
        ...(editSecret.trim() ? { secret: editSecret.trim() } : {}),
      });
      setList((p) => (p ? p.map((d) => (d.id === r.destination.id ? r.destination : d)) : p));
      setEditingId(null);
      toast.success(editSecret.trim() ? "Destination updated, secret rotated." : "Destination updated.");
    } catch (e) {
      if (e instanceof ApiError && e.code === "invalid_url") {
        setEditError("Enter a valid https:// URL (no private hosts).");
      } else {
        setEditError("Couldn't update the destination. Try again.");
      }
    } finally {
      setSaving(false);
    }
  }

  async function test(id: string) {
    setTestingId(id);
    try {
      const r = await api.testCrmDestination(id);
      if (r.ok) toast.success("Test push delivered.");
      else toast.error("Destination didn't accept the test (non-2xx).");
    } catch (e) {
      toastApiError(e, { title: "Test failed" });
    } finally {
      setTestingId(null);
    }
  }

  return (
    <SettingsSection
      title="CRM & webhooks"
      description={
        <>
          Push every alerted signal to a URL: Zapier, Make, n8n or your CRM. Signed with{" "}
          <span className="font-mono">X-Outrival-Signature</span> when a secret is set.
        </>
      }
    >
      {locked && (
        <div className="text-muted-foreground rounded-md border border-dashed border-border px-3 py-2 text-xs">
          Outbound webhooks are available on the{" "}
          <span className="text-foreground font-medium">Business</span> plan.
        </div>
      )}

      {listQ.isError ? (
        <SettingsError
          title="Destinations didn't load"
          error={listQ.error}
          onRetry={() => void listQ.refetch()}
        />
      ) : listQ.isPending ? (
        <SettingCardRowsSkeleton rows={1} />
      ) : list && list.length > 0 ? (
        <Card className="divide-y divide-border overflow-hidden">
          {list.map((d) =>
            editingId === d.id ? (
              <div key={d.id} className="flex flex-wrap items-center gap-2 px-4 py-3">
                <Input
                  value={editName}
                  onChange={(e) => {
                    setEditName(e.target.value);
                    setEditError(null);
                  }}
                  placeholder="Name"
                  className="h-8 w-32 text-dense"
                />
                <Input
                  value={editUrl}
                  onChange={(e) => {
                    setEditUrl(e.target.value);
                    setEditError(null);
                  }}
                  placeholder="https://…"
                  className="h-8 min-w-[180px] flex-1 text-dense"
                />
                <Input
                  value={editSecret}
                  onChange={(e) => setEditSecret(e.target.value)}
                  placeholder={d.hasSecret ? "New secret (kept if empty)" : "Secret (optional)"}
                  className="h-8 w-44 text-dense"
                />
                <Button
                  size="sm"
                  onClick={saveEdit}
                  disabled={saving || !editName.trim() || !editUrl.trim()}
                >
                  {saving ? <SpinnerIcon size={16} className="animate-spin" /> : "Save"}
                </Button>
                <Button variant="ghost" size="sm" disabled={saving} onClick={() => setEditingId(null)}>
                  Cancel
                </Button>
                {editError && <p className="w-full text-xs text-critical">{editError}</p>}
              </div>
            ) : (
              <div key={d.id} className="flex items-center gap-3 px-4 py-3">
                <WebhooksLogoIcon size={16} className="text-muted-foreground shrink-0" aria-hidden />
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
                    <SpinnerIcon size={16} className="animate-spin" />
                  ) : (
                    <PaperPlaneTiltIcon size={16} />
                  )}
                  Test
                </Button>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  aria-label="Edit destination"
                  onClick={() => startEdit(d)}
                  className="text-muted-foreground"
                >
                  <PencilIcon size={16} />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  aria-label="Delete destination"
                  onClick={() => setRemoveTarget(d)}
                  className="text-muted-foreground hover:text-critical"
                >
                  <TrashIcon size={16} />
                </Button>
              </div>
            ),
          )}
        </Card>
      ) : (
        // The list used to render nothing at all when empty, so the section opened
        // on a bare form with no statement of what it was for.
        <EmptyState
          icon={WebhooksLogoIcon}
          title="No destinations yet"
          description="Add a URL below and every alerted signal is pushed to it as JSON, within seconds of being detected."
        />
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Input
          placeholder="Name"
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            setAddError(null);
          }}
          className="h-8 w-32 text-dense"
        />
        <Input
          placeholder="https://…"
          value={url}
          onChange={(e) => {
            setUrl(e.target.value);
            setAddError(null);
          }}
          className="h-8 min-w-[180px] flex-1 text-dense"
        />
        <Input
          placeholder="Secret (optional)"
          value={secret}
          onChange={(e) => setSecret(e.target.value)}
          className="h-8 w-40 text-dense"
        />
        <Button size="sm" onClick={add} disabled={adding || !name.trim() || !url.trim()}>
          <PlusIcon size={16} /> Add
        </Button>
      </div>
      {addError && <p className="text-xs text-critical">{addError}</p>}

      <Dialog
        open={removeTarget != null}
        onOpenChange={(open) => {
          if (!open) setRemoveTarget(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove {removeTarget?.name}?</DialogTitle>
            <DialogDescription>
              Signals stop being pushed to this URL immediately. The secret isn't
              recoverable, so re-adding it means setting a new one.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setRemoveTarget(null)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={remove}>
              Remove destination
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </SettingsSection>
  );
}
