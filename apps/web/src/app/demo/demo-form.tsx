"use client";

import { useState } from "react";
import { CheckCircle2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

const TEAM_SIZES = ["Just me", "2–10", "11–50", "51–200", "200+"];

type Status = "idle" | "submitting" | "success" | "error";

export function DemoForm({ defaultPlan }: { defaultPlan?: string }) {
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
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
    setStatus("submitting");
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/api/contact`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, plan: defaultPlan }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { message?: string };
        throw new Error(body.message ?? "Something went wrong. Please try again.");
      }
      setStatus("success");
    } catch (err) {
      setStatus("error");
      setError(err instanceof Error ? err.message : "Something went wrong.");
    }
  }

  if (status === "success") {
    return (
      <div className="flex flex-col items-start justify-center rounded-xl border border-border bg-surface p-8">
        <CheckCircle2 className="text-primary" size={28} />
        <h2 className="mt-4 text-xl font-semibold tracking-tight">
          Thanks — we&apos;ll be in touch.
        </h2>
        <p className="mt-2 text-sm leading-relaxed text-text-muted">
          Your request landed in our inbox. Expect a reply within one business
          day at <span className="text-foreground">{form.email}</span>.
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
            <select
              id="teamSize"
              value={form.teamSize}
              onChange={(e) => set("teamSize", e.target.value)}
              className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-xs outline-none transition-[color,box-shadow] focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 dark:bg-input/30"
            >
              <option value="">Select…</option>
              {TEAM_SIZES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="message">What would you like to see?</Label>
          <Textarea
            id="message"
            rows={4}
            value={form.message}
            onChange={(e) => set("message", e.target.value)}
          />
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
