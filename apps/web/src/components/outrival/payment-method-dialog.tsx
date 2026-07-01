"use client";

import { useEffect, useMemo, useState } from "react";
import { useTheme } from "next-themes";
import { loadStripe, type Stripe } from "@stripe/stripe-js";
import {
  Elements,
  PaymentElement,
  useElements,
  useStripe,
} from "@stripe/react-stripe-js";
import { Loader2 } from "lucide-react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

const PUBLISHABLE_KEY = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;

// loadStripe must run once, outside render — cache the promise module-wide.
let stripePromise: Promise<Stripe | null> | null = null;
function getStripePromise(): Promise<Stripe | null> | null {
  if (!PUBLISHABLE_KEY) return null;
  if (!stripePromise) stripePromise = loadStripe(PUBLISHABLE_KEY);
  return stripePromise;
}

export function PaymentMethodDialog({
  open,
  onOpenChange,
  onUpdated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onUpdated: () => void;
}) {
  const { resolvedTheme } = useTheme();
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const stripePromise = getStripePromise();

  // SetupIntents are single-use → mint a fresh one every time the dialog opens, and
  // drop it on close so a re-open never confirms a stale secret.
  useEffect(() => {
    if (!open) {
      setClientSecret(null);
      setError(null);
      return;
    }
    let cancelled = false;
    api
      .createSetupIntent()
      .then((r) => {
        if (!cancelled) setClientSecret(r.clientSecret);
      })
      .catch((e) => {
        if (!cancelled) setError(String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  const options = useMemo(
    () =>
      clientSecret
        ? {
            clientSecret,
            appearance: {
              theme:
                resolvedTheme === "dark"
                  ? ("night" as const)
                  : ("stripe" as const),
              variables: { colorPrimary: "#6366f1" },
            },
          }
        : undefined,
    [clientSecret, resolvedTheme],
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Update payment method</DialogTitle>
          <DialogDescription>
            Your card is sent straight to Stripe — it never touches our servers. The
            new card is charged on your next invoice.
          </DialogDescription>
        </DialogHeader>

        {!PUBLISHABLE_KEY ? (
          <p className="text-sm text-destructive">
            Payments aren’t configured. Set NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY.
          </p>
        ) : error ? (
          <p className="text-sm text-destructive">{error}</p>
        ) : !options || !stripePromise ? (
          <div className="flex items-center justify-center py-8 text-muted-foreground">
            <Loader2 size={16} className="animate-spin" />
          </div>
        ) : (
          <Elements stripe={stripePromise} options={options}>
            <PaymentMethodForm
              onUpdated={onUpdated}
              onCancel={() => onOpenChange(false)}
            />
          </Elements>
        )}
      </DialogContent>
    </Dialog>
  );
}

function PaymentMethodForm({
  onUpdated,
  onCancel,
}: {
  onUpdated: () => void;
  onCancel: () => void;
}) {
  const stripe = useStripe();
  const elements = useElements();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!stripe || !elements) return;
    setBusy(true);
    setError(null);

    // redirect: "if_required" keeps card (incl. 3DS) inline — no return_url round-trip.
    const { error: confirmError, setupIntent } = await stripe.confirmSetup({
      elements,
      redirect: "if_required",
    });

    if (confirmError) {
      setError(confirmError.message ?? "Could not save your card. Try again.");
      setBusy(false);
      return;
    }

    const pmId =
      typeof setupIntent?.payment_method === "string"
        ? setupIntent.payment_method
        : (setupIntent?.payment_method?.id ?? null);
    if (!pmId) {
      setError("Card saved but couldn’t be set as default. Try again.");
      setBusy(false);
      return;
    }

    try {
      await api.setDefaultPaymentMethod(pmId);
      onUpdated();
    } catch (err) {
      setError(String(err));
      setBusy(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <PaymentElement />
      {error && <p className="text-sm text-destructive">{error}</p>}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
        <Button type="submit" disabled={busy || !stripe}>
          {busy && <Loader2 size={12} className="animate-spin" />}
          {busy ? "Saving…" : "Save card"}
        </Button>
      </div>
    </form>
  );
}
