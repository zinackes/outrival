"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Copy, Trash2, Link2 } from "lucide-react";
import { api } from "@/lib/api";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

// Shared reports (Lever 8) — the revocable list required by the security note: every
// active public "Competitive Snapshot" link, with copy + revoke. Links are created
// from the Overview's "Share snapshot"; here the user can kill them.
export function SharedReportsSettings() {
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: ["share-links"],
    queryFn: () => api.listShareLinks(),
  });
  const links = data?.links ?? [];

  const revoke = async (id: string) => {
    try {
      await api.revokeShareLink(id);
      await qc.invalidateQueries({ queryKey: ["share-links"] });
      toast.success("Link revoked — it no longer opens.");
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
      <header>
        <h2 className="font-semibold text-base tracking-tight">Shared reports</h2>
        <p className="text-muted-foreground text-sm mt-1">
          Public read-only links to your Competitive Snapshot. Anyone with a link can view
          it — revoke anytime.
        </p>
      </header>

      {links.length === 0 ? (
        <Card className="px-5 py-4">
          <div className="text-dense text-muted-foreground">
            No shared reports yet. Create one from the Overview with “Share snapshot”.
          </div>
        </Card>
      ) : (
        links.map((link) => (
          <Card key={link.id} className="flex items-center gap-3 px-5 py-4">
            <Link2 className="size-4 shrink-0 text-muted-foreground" />
            <div className="min-w-0 flex-1">
              <div className="truncate text-dense font-mono">{link.url}</div>
              <div className="text-meta text-muted-foreground mt-0.5">
                Created {new Date(link.createdAt).toLocaleDateString("en-US")}
              </div>
            </div>
            <Button variant="ghost" size="sm" onClick={() => copy(link.url)}>
              <Copy className="size-4" />
              Copy
            </Button>
            <Button variant="ghost" size="sm" onClick={() => revoke(link.id)}>
              <Trash2 className="size-4" />
              Revoke
            </Button>
          </Card>
        ))
      )}
    </section>
  );
}
