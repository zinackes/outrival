"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

// Step-up re-auth control for destructive actions: emails a confirmation code to
// the account address, then collects it. Shared by the delete-workspace and
// delete-account dialogs. The parent gates its destructive button on a 6-digit
// code and passes it to the API alongside the type-to-confirm value.
export function ReauthCodeField({
  code,
  onCode,
}: {
  code: string;
  onCode: (value: string) => void;
}) {
  const [sent, setSent] = useState(false);
  const [sending, setSending] = useState(false);

  async function send() {
    setSending(true);
    try {
      await api.sendReauthCode();
      setSent(true);
      toast.success("Confirmation code sent to your email.");
    } catch {
      toast.error("Couldn't send the code. Try again.");
    } finally {
      setSending(false);
    }
  }

  if (!sent) {
    return (
      <Button
        variant="outline"
        size="sm"
        onClick={send}
        disabled={sending}
        className="w-fit"
      >
        {sending && <Loader2 size={13} className="animate-spin" />}
        Email me a confirmation code
      </Button>
    );
  }

  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor="reauth-code" className="text-dense">
        Confirmation code
      </Label>
      <Input
        id="reauth-code"
        inputMode="numeric"
        autoComplete="one-time-code"
        maxLength={6}
        value={code}
        onChange={(e) => onCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
        placeholder="123456"
        className="font-mono tracking-[0.3em]"
      />
      <button
        type="button"
        onClick={send}
        disabled={sending}
        className="w-fit text-meta text-muted-foreground hover:text-foreground transition-colors"
      >
        Resend code
      </button>
    </div>
  );
}
