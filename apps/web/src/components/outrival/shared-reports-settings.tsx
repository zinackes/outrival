"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { CopyIcon, TrashIcon, LinkIcon, PlusIcon } from "@/components/icons";
import { api } from "@/lib/api";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

// Shared reports (Lever 8) — the home for public "Competitive Snapshot" links: create
// one, copy it, and revoke it. This is the single place links live (the revocable list
// the security note requires); every active link is listed with copy + revoke.
export function SharedReportsSettings() {
  const qc = useQueryClient();
  const [creating, setCreating] = useState(false);
  const { data } = useQuery({
    queryKey: ["share-links"],
    queryFn: () => api.listShareLinks(),
  });
  const links = data?.links ?? [];

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
      toast.error("Couldn’t create the link. Please try again.");
    } finally {
      setCreating(false);
    }
  };

  const revoke = async (id: string) => {
    try {
      await api.revokeShareLink(id);
      await qc.invalidateQueries({ queryKey: ["share-links"] });
      toast.success("Link revoked. It no longer opens.");
    } catch {
      toast.error("Couldn’t revoke the link. Please try again.");
    }
  };

  const copy = (url: string) => {
    void navigator.clipboard?.writeText(url);
    toast.success("Link copied");
  };

  return (
    <section className="flex flex-col gap-5">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h2 className="font-semibold text-base tracking-tight">Shared reports</h2>
          <p className="text-muted-foreground text-sm mt-1">
            Public read-only links to your Competitive Snapshot. Anyone with a link can view
            it. Revoke anytime.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={create} disabled={creating}>
          <PlusIcon className="size-4" />
          Create link
        </Button>
      </header>

      {links.length === 0 ? (
        <Card className="px-5 py-4">
          <div className="text-dense text-muted-foreground">
            No shared reports yet. Create a link to share a read-only Competitive
            Snapshot of your landscape with anyone.
          </div>
        </Card>
      ) : (
        links.map((link) => (
          <Card key={link.id} className="flex items-center gap-3 px-5 py-4">
            <LinkIcon className="size-3.5 shrink-0 text-muted-foreground" />
            <div className="min-w-0 flex-1">
              <div className="truncate text-dense font-mono">{link.url}</div>
              <div className="text-meta text-muted-foreground mt-0.5">
                Created {new Date(link.createdAt).toLocaleDateString("en-US")}
              </div>
            </div>
            <Button variant="ghost" size="sm" onClick={() => copy(link.url)}>
              <CopyIcon className="size-4" />
              Copy
            </Button>
            <Button variant="ghost" size="sm" onClick={() => revoke(link.id)}>
              <TrashIcon className="size-4" />
              Revoke
            </Button>
          </Card>
        ))
      )}
    </section>
  );
}
