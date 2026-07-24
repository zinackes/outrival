"use client";

import { useRef, useState } from "react";
import { Turnstile, type TurnstileInstance } from "@marsidev/react-turnstile";
import { CheckCircle2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";
const TURNSTILE_SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;

const TEAM_SIZES = ["Just me", "2–10", "11–50", "51–200", "200+"];

type Status = "idle" | "submitting" | "success" | "error";

export function DemoForm({
  defaultPlan,
  intent,
}: {
  defaultPlan?: string;
  /** "sample" asks for the two things the sample-digest offer needs. */
  intent?: "sample";
}) {
  const isSample = intent === "sample";
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  const turnstileRef = useRef<TurnstileInstance | null>(null);
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const turnstileRequired = Boolean(TURNSTILE_SITE_KEY);
  const tokenReady = !turnstileRequired || Boolean(turnstileToken);
  const [form, setForm] = useState({
    name: "",
    email: "",
    company: "",
    teamSize: "",
    message: defaultPlan === "business" ? "I'm interested in the Business plan." : "",
    website: "", // honeypot
  });

  function set<K extends keyof typeof form>(key: K, value: string) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (status === "submitting") return;
    if (!tokenReady) {
      setError("Please wait a moment and try again.");
      return;
    }
    setStatus("submitting");
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/api/contact`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          plan: defaultPlan,
          turnstileToken: turnstileToken ?? "",
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { message?: string };
        throw new Error(body.message ?? "Something went wrong. Please try again.");
      }
      setStatus("success");
    } catch (err) {
      setStatus("error");
      setError(err instanceof Error ? err.message : "Something went wrong.");
      // Turnstile tokens are single-use; refresh so a retry has a fresh one.
      turnstileRef.current?.reset();
      setTurnstileToken(null);
    }
  }

  if (status === "success") {
    return (
      <div
        role="status"
        className="flex flex-col items-start justify-center rounded-xl border border-border bg-surface p-8"
      >
        <CheckCircle2 className="text-primary" size={28} />
        <h2 className="mt-4 text-xl font-semibold tracking-tight">
          {isSample ? "Thanks, your brief is queued." : "Thanks, we'll be in touch."}
        </h2>
        <p className="mt-2 text-sm leading-relaxed text-text-muted">
          {isSample ? (
            <>
              We&apos;ll scrape the three sites you named and send the brief to{" "}
              <span className="text-foreground">{form.email}</span>. These are
              written by hand, so give us a few days, and you&apos;ll hear back
              either way.
            </>
          ) : (
            <>
              Your message landed in our inbox at{" "}
              <span className="text-foreground">{form.email}</span>. The founder
              reads every one and will reply personally.
            </>
          )}
        </p>
      </div>
    );
  }

  return (
    <form
      onSubmit={onSubmit}
      className="rounded-xl border border-border bg-surface p-6 sm:p-8"
    >
      <div className="grid gap-4">
        <div className="grid gap-1.5">
          <Label htmlFor="name">Name</Label>
          <Input
            id="name"
            required
            autoComplete="name"
            value={form.name}
            onChange={(e) => set("name", e.target.value)}
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="email">Work email</Label>
          <Input
            id="email"
            type="email"
            required
            autoComplete="email"
            value={form.email}
            onChange={(e) => set("email", e.target.value)}
          />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="grid gap-1.5">
            <Label htmlFor="company">Company</Label>
            <Input
              id="company"
              autoComplete="organization"
              value={form.company}
              onChange={(e) => set("company", e.target.value)}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="teamSize">Team size</Label>
            <Select
              value={form.teamSize}
              onValueChange={(value) => set("teamSize", value)}
            >
              <SelectTrigger id="teamSize" className="w-full">
                <SelectValue placeholder="Select…" />
              </SelectTrigger>
              <SelectContent>
                {TEAM_SIZES.map((s) => (
                  <SelectItem key={s} value={s}>
                    {s}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="message">
            {isSample
              ? "Your product and two competitors"
              : "What would you like to see?"}
          </Label>
          <Textarea
            id="message"
            rows={4}
            required={isSample}
            placeholder={
              isSample
                ? "Your site, then two competitors. URLs are ideal."
                : undefined
            }
            value={form.message}
            onChange={(e) => set("message", e.target.value)}
          />
          {isSample && (
            <p className="text-xs text-text-subtle">
              We scrape these three and write the brief from what we find.
            </p>
          )}
        </div>

        {/* Honeypot — hidden from humans, catches bots. */}
        <input
          type="text"
          name="website"
          tabIndex={-1}
          autoComplete="off"
          aria-hidden="true"
          value={form.website}
          onChange={(e) => set("website", e.target.value)}
          className="absolute left-[-9999px] h-0 w-0 opacity-0"
        />

        {/* Invisible managed Turnstile — no-op in dev when the site key is unset. */}
        {turnstileRequired && (
          <Turnstile
            ref={turnstileRef}
            siteKey={TURNSTILE_SITE_KEY!}
            options={{ appearance: "interaction-only" }}
            onSuccess={setTurnstileToken}
            onExpire={() => setTurnstileToken(null)}
            onError={() => setTurnstileToken(null)}
          />
        )}

        {error && (
          <p role="alert" className="text-sm text-critical">
            {error}
          </p>
        )}

        <Button type="submit" size="lg" disabled={status === "submitting"} className="w-full">
          {status === "submitting" ? (
            <>
              <Loader2 className="animate-spin" size={16} /> Sending…
            </>
          ) : isSample ? (
            "Get my sample digest"
          ) : (
            "Send request"
          )}
        </Button>
        <p className="text-xs text-text-subtle">
          We&apos;ll only use this to reply to your request. No spam, ever.
        </p>
      </div>
    </form>
  );
}
