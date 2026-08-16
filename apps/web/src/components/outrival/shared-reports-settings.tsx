"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "@/lib/toast";
import { CopyIcon, TrashIcon, LinkIcon, PlusIcon, SpinnerIcon } from "@/components/icons";
import { api } from "@/lib/api";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
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

// Shared reports (Lever 8) — the home for public "Competitive Snapshot" links: create
// one, copy it, and revoke it. This is the single place links live (the revocable list
// the security note requires); every active link is listed with copy + revoke.
export function SharedReportsSettings() {
  const qc = useQueryClient();
  const [creating, setCreating] = useState(false);
  // A public link keeps working until it's revoked, so revoking is destructive and
  // irreversible from the reader's side — it asks first, like every other one.
  //
  // Revocation is not instant, and the UI says so rather than promising otherwise:
  // /report/[token] renders through Next's full-route cache with `revalidate: 300`
  // (apps/web/src/app/report/[token]/page.tsx), so a page that already rendered
  // successfully can keep being served for up to five minutes after the token is
  // revoked. Only a page that has never rendered — or whose window has expired —
  // reaches the API and gets the 404. That 300s is the whole propagation window.
  const [revokeTarget, setRevokeTarget] = useState<string | null>(null);
  const [revoking, setRevoking] = useState(false);
  const linksQ = useQuery({
    queryKey: ["share-links"],
    queryFn: () => api.listShareLinks(),
  });
  const links = linksQ.data?.links ?? [];

  // Create-or-return for the primary product, so this list is a place to create a
  // link too (not just manage day-0 ones). Copies the URL on success.
  const create = async () => {
    setCreating(true);
    try {
      const { url } = await api.createShareLink();
      await navigator.clipboard?.writeText(url);
      await qc.invalidateQueries({ queryKey: ["share-links"] });
      toast.success("Snapshot link created & copied", {
        description: "Anyone with the link can view this report.",
      });
    } catch {
      toast.error("Couldn't create the link. Please try again.");
    } finally {
      setCreating(false);
    }
  };

  const revoke = async () => {
    if (!revokeTarget) return;
    setRevoking(true);
    try {
      await api.revokeShareLink(revokeTarget);
      await qc.invalidateQueries({ queryKey: ["share-links"] });
      setRevokeTarget(null);
      toast.success("Link revoked", {
        description: "It stops opening within 5 minutes, once the cached page expires.",
      });
    } catch {
      toast.error("Couldn't revoke the link. Please try again.");
    } finally {
      setRevoking(false);
    }
  };

  const copy = (url: string) => {
    void navigator.clipboard?.writeText(url);
    toast.success("Link copied");
  };

  return (
    <SettingsSection
      title="Shared reports"
      description="Public read-only links to your Competitive Snapshot. Anyone with a link can view it. Revoke anytime — a revoked link stops opening within 5 minutes."
      action={
        <Button variant="outline" size="sm" onClick={create} disabled={creating}>
          {creating ? (
            <SpinnerIcon size={16} className="animate-spin" />
          ) : (
            <PlusIcon size={16} />
          )}
          Create link
        </Button>
      }
      divider={false}
    >
      {linksQ.isError ? (
        <SettingsError
          title="Shared reports didn't load"
          error={linksQ.error}
          onRetry={() => void linksQ.refetch()}
        />
      ) : linksQ.isPending ? (
        <SettingCardRowsSkeleton rows={1} />
      ) : links.length === 0 ? (
        // The shared empty state, like every other list on the settings pages: an
        // explanation of what a link is for, plus the way to make one.
        <EmptyState
          icon={LinkIcon}
          title="No shared reports yet"
          description="Create a link to share a read-only Competitive Snapshot of your landscape with anyone — no account needed on their side."
          actions={
            <Button variant="outline" size="sm" onClick={create} disabled={creating}>
              <PlusIcon size={16} />
              Create link
            </Button>
          }
        />
      ) : (
        <Card className="divide-y divide-border p-0">
          {links.map((link) => (
            <div key={link.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
              <LinkIcon size={16} className="shrink-0 text-muted-foreground" aria-hidden />
              <div className="min-w-0 flex-1">
                <div className="truncate text-dense font-mono">{link.url}</div>
                <div className="text-meta text-muted-foreground mt-0.5">
                  Created {new Date(link.createdAt).toLocaleDateString("en-US")}
                </div>
              </div>
              <Button variant="ghost" size="sm" onClick={() => copy(link.url)}>
                <CopyIcon size={16} />
                Copy
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setRevokeTarget(link.id)}
                className="text-critical hover:text-critical"
              >
                <TrashIcon size={16} />
                Revoke
              </Button>
            </div>
          ))}
        </Card>
      )}

      <Dialog
        open={revokeTarget != null}
        onOpenChange={(open) => {
          if (!open && !revoking) setRevokeTarget(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Revoke this link?</DialogTitle>
            <DialogDescription>
              Anyone who already has it stops being able to open the report, within
              5 minutes: the public page is cached that long, so a copy already
              rendered can still be served until the cache expires. This can't be
              undone — you'd have to create a new link and share it again.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setRevokeTarget(null)} disabled={revoking}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={revoke} disabled={revoking}>
              {revoking && <SpinnerIcon size={16} className="animate-spin" />}
              Revoke link
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </SettingsSection>
  );
}
