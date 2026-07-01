"use client";

import { useState } from "react";
import { useSession } from "@/lib/auth-client";
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
import { toastApiError } from "@/lib/error-helpers";
import { ReauthCodeField } from "@/components/outrival/reauth-code-field";

// Permanent account erasure (GDPR). Distinct from "delete workspace": this also
// removes your login, so you're signed out for good rather than dropped into a
// fresh empty workspace.
export function DeleteAccountCard() {
  const { data: session } = useSession();
  const email = session?.user?.email ?? "";
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState("");
  const [code, setCode] = useState("");
  const [deleting, setDeleting] = useState(false);

  async function handleDelete() {
    setDeleting(true);
    try {
      await api.deleteAccount(confirm, code);
      // The Better Auth identity (and its session) is gone — hard-navigate to the
      // landing page; the dead cookie resolves to a logged-out state.
      window.location.assign("/");
    } catch (err) {
      setDeleting(false);
      toastApiError(err, { title: "Couldn't delete the account" });
    }
  }

  const confirmMatches = email !== "" && confirm.trim().toLowerCase() === email.toLowerCase();
  const canDelete = confirmMatches && code.length === 6;

  return (
    <Card className="border-critical/20 px-5 py-5">
      <div className="flex items-center gap-3">
        <div className="flex-1">
          <div className="font-semibold text-sm">Delete account</div>
          <div className="text-muted-foreground text-dense mt-1">
            Erases your workspace and removes your login entirely. You'll be signed
            out and can't sign back in. This cannot be undone.
          </div>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="text-destructive border-destructive/25"
          onClick={() => setOpen(true)}
        >
          Delete account
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
            <DialogTitle>Delete your account?</DialogTitle>
            <DialogDescription>
              Your workspace and all of its data are permanently erased, any active
              subscription is cancelled, and your login is removed. This cannot be
              undone.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-2">
            <Label htmlFor="confirm-account-email" className="text-dense">
              Type your email{" "}
              <span className="font-semibold text-foreground" data-ph-mask>
                {email || "address"}
              </span>{" "}
              to confirm
            </Label>
            <Input
              id="confirm-account-email"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              placeholder={email}
              autoComplete="off"
              data-ph-mask
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
              {deleting ? "Deleting…" : "Delete account"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
