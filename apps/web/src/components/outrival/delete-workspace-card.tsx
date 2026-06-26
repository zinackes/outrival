"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
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
import { ReauthCodeField } from "@/components/outrival/reauth-code-field";

export function DeleteWorkspaceCard() {
  const [open, setOpen] = useState(false);
  const [workspaceName, setWorkspaceName] = useState<string | null>(null);
  const [confirm, setConfirm] = useState("");
  const [code, setCode] = useState("");
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    api
      .getWorkspaceSettings()
      .then((w) => setWorkspaceName(w.name))
      .catch(() => setWorkspaceName(null));
  }, []);

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
      toast.error(err instanceof Error ? err.message : "Deletion failed — try again.");
    }
  }

  const confirmMatches = workspaceName !== null && confirm === workspaceName;
  const canDelete = confirmMatches && code.length === 6;

  return (
    <Card className="border-critical/20 px-5 py-5">
      <div className="flex items-center gap-3">
        <div className="flex-1">
          <div className="font-semibold text-sm">Delete workspace</div>
          <div className="text-muted-foreground text-dense mt-1">
            Permanently erases all signals, digests and battle cards. This
            action cannot be undone.
          </div>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="text-destructive border-destructive/25"
          onClick={() => setOpen(true)}
        >
          Delete
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
    </Card>
  );
}
