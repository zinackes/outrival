"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Mail, Ban, ShieldCheck, Trash2, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Section } from "../../_components/shell";
import { api, type AdminUserDetail } from "@/lib/api";

const PLANS = ["free", "starter", "pro", "business"] as const;
const PERIODS = ["monthly", "yearly"] as const;

export function ManageAccount({ detail }: { detail: AdminUserDetail }) {
  const router = useRouter();
  const userId = detail.user.id;
  const initialPlan = detail.org?.plan ?? "free";
  const initialPeriod = detail.org?.planPeriod ?? "none";

  const [plan, setPlan] = useState(initialPlan);
  const [period, setPeriod] = useState<string>(initialPeriod);
  const [suspended, setSuspended] = useState(!!detail.user.suspendedAt);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmText, setConfirmText] = useState("");

  const planDirty = plan !== initialPlan || period !== initialPeriod;

  async function savePlan() {
    setBusy("plan");
    try {
      await api.adminUpdateUserPlan(userId, { plan, planPeriod: period === "none" ? null : period });
      toast.success("Plan updated");
      router.refresh();
    } catch {
      toast.error("Could not update plan");
    } finally {
      setBusy(null);
    }
  }

  async function sendLink() {
    setBusy("link");
    try {
      await api.adminSendLoginLink(userId);
      toast.success("Sign-in link sent", { description: detail.user.email });
    } catch {
      toast.error("Could not send link");
    } finally {
      setBusy(null);
    }
  }

  async function toggleSuspend() {
    setBusy("suspend");
    try {
      if (suspended) {
        await api.adminUnsuspendUser(userId);
        setSuspended(false);
        toast.success("Account reactivated");
      } else {
        await api.adminSuspendUser(userId);
        setSuspended(true);
        toast.success("Account suspended");
      }
      router.refresh();
    } catch {
      toast.error("Could not update suspension");
    } finally {
      setBusy(null);
    }
  }

  async function deleteAccount() {
    setBusy("delete");
    try {
      await api.adminDeleteUser(userId, confirmText);
      toast.success("Account deleted");
      router.push("/admin/users");
    } catch {
      toast.error("Could not delete account");
      setBusy(null);
    }
  }

  return (
    <Section
      title="Manage"
      info="Operator actions on this account: change the plan (a manual grant — does not touch Stripe), resend a sign-in link, suspend access, or permanently delete the workspace."
    >
      <div className="flex flex-col gap-5">
        <div className="flex flex-col gap-2">
          <span className="text-sm font-medium">Plan</span>
          {detail.org ? (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <Select value={plan} onValueChange={setPlan}>
                  <SelectTrigger className="h-9 w-36">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PLANS.map((p) => (
                      <SelectItem key={p} value={p}>
                        {p}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select value={period} onValueChange={setPeriod}>
                  <SelectTrigger className="h-9 w-36">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">No period</SelectItem>
                    {PERIODS.map((p) => (
                      <SelectItem key={p} value={p}>
                        {p}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button size="sm" className="h-9" disabled={!planDirty || busy === "plan"} onClick={savePlan}>
                  Save
                </Button>
              </div>
              {detail.org.hasActiveStripeSub ? (
                <p className="flex items-start gap-1.5 text-sm text-muted-foreground">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  This org has an active Stripe subscription — a manual change is an operator
                  grant and may be overwritten by the next Stripe webhook.
                </p>
              ) : null}
            </>
          ) : (
            <p className="text-sm text-muted-foreground">User has no organisation.</p>
          )}
        </div>

        <div className="flex flex-col gap-2">
          <span className="text-sm font-medium">Login</span>
          <div>
            <Button variant="ghost" size="sm" disabled={busy === "link" || suspended} onClick={sendLink}>
              <Mail className="mr-1.5 h-3.5 w-3.5" />
              Resend sign-in link
            </Button>
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <span className="text-sm font-medium text-destructive">Danger zone</span>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" disabled={busy === "suspend"} onClick={toggleSuspend}>
              {suspended ? (
                <>
                  <ShieldCheck className="mr-1.5 h-3.5 w-3.5" />
                  Reactivate account
                </>
              ) : (
                <>
                  <Ban className="mr-1.5 h-3.5 w-3.5" />
                  Suspend account
                </>
              )}
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={() => {
                setConfirmText("");
                setConfirmOpen(true);
              }}
            >
              <Trash2 className="mr-1.5 h-3.5 w-3.5" />
              Delete account
            </Button>
          </div>
          <p className="text-sm text-muted-foreground">
            Suspending blocks all access immediately. Deleting permanently erases the user and
            their entire workspace (competitors, monitors, signals, history).
          </p>
        </div>
      </div>

      <Dialog open={confirmOpen} onOpenChange={(o) => !o && setConfirmOpen(false)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete this account?</DialogTitle>
            <DialogDescription>
              This permanently erases {detail.user.email} and their entire workspace. This cannot
              be undone. Type the email to confirm.
            </DialogDescription>
          </DialogHeader>
          <Input
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            placeholder={detail.user.email}
            autoComplete="off"
          />
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirmOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={confirmText !== detail.user.email || busy === "delete"}
              onClick={deleteAccount}
            >
              Delete permanently
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Section>
  );
}
