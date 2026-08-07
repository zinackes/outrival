"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
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
import { api } from "@/lib/api";
import { toastApiError } from "@/lib/error-helpers";
import { workspaceSettingsQuery } from "@/lib/queries";
import { ReauthCodeField } from "@/components/outrival/reauth-code-field";
import { SettingsSection } from "@/components/dashboard/settings-page";

export function DeleteWorkspaceCard() {
  const [open, setOpen] = useState(false);
  // Shares the ["workspaceSettings"] cache with the General settings form.
  const settingsQ = useQuery(workspaceSettingsQuery());
  const workspaceName = settingsQ.data?.name ?? null;
  const [confirm, setConfirm] = useState("");
  const [code, setCode] = useState("");
  const [deleting, setDeleting] = useState(false);

  async function handleDelete() {
    setDeleting(true);
    try {
      await api.deleteWorkspace(confirm, code);
      // The org is gone; the next dashboard request creates a fresh empty one
      // and the layout routes through onboarding. Hard navigation so no stale
      // client cache survives the deletion.
      window.location.assign("/dashboard");
    } catch (err) {
      setDeleting(false);
      toastApiError(err, { title: "Couldn't delete the workspace" });
    }
  }

  const confirmMatches = workspaceName !== null && confirm === workspaceName;
  const canDelete = confirmMatches && code.length === 6;

  return (
    // A section, not a card with a bold div for a title: the two danger actions
    // are the page's two sections, and the h2 rank is what heading navigation
    // and the rest of the redesign already use.
    <SettingsSection
      title="Delete workspace"
      description="Permanently erases every competitor, signal, digest, battle card and snapshot in this workspace, and cancels any active subscription."
      divider={false}
    >
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-critical/25 bg-critical/[0.06] px-4 py-3.5">
        <p className="text-dense text-muted-foreground">
          Your login survives — you land in a fresh, empty workspace.
        </p>
        <Button
          variant="outline"
          size="sm"
          className="border-critical/30 text-critical hover:text-critical"
          onClick={() => setOpen(true)}
        >
          Delete workspace
        </Button>
      </div>

      <Dialog
        open={open}
        onOpenChange={(o) => {
          if (deleting) return;
          setOpen(o);
          if (!o) {
            setConfirm("");
            setCode("");
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete this workspace?</DialogTitle>
            <DialogDescription>
              All competitors, signals, digests, battle cards and snapshots will
              be permanently erased, and any active subscription cancelled. This
              cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-2">
            <Label htmlFor="confirm-workspace-name" className="text-dense">
              Type{" "}
              <span className="font-semibold text-foreground">
                {workspaceName ?? "your workspace name"}
              </span>{" "}
              to confirm
            </Label>
            <Input
              id="confirm-workspace-name"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              placeholder={workspaceName ?? ""}
              autoComplete="off"
            />
          </div>
          <ReauthCodeField code={code} onCode={setCode} />
          <DialogFooter>
            <Button variant="ghost" size="sm" disabled={deleting} onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              size="sm"
              disabled={!canDelete || deleting}
              onClick={handleDelete}
            >
              {deleting ? "Deleting…" : "Delete workspace"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </SettingsSection>
  );
}
