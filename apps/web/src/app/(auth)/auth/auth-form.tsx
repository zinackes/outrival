"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Turnstile } from "@marsidev/react-turnstile";
import { ArrowLeft, ArrowRight, CornerDownRight, Loader2, Mail } from "lucide-react";
import { emailSchema } from "@outrival/shared";
import { signIn } from "@/lib/auth-client";
import { track, identifyUser } from "@/lib/posthog/events";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "";
const TURNSTILE_SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;

type Status = "idle" | "sending" | "sent" | "error";

function validateEmailInline(email: string): string | null {
  if (!email) return null;
  const result = emailSchema.safeParse(email);
  return result.success ? null : (result.error.issues[0]?.message ?? "Invalid email");
}

export function AuthForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const [usePassword, setUsePassword] = useState(false);
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState("");

  const turnstileRequired = Boolean(TURNSTILE_SITE_KEY);
  const tokenReady = !turnstileRequired || Boolean(turnstileToken);

  function dashboardCallback(): string {
    return typeof window !== "undefined"
      ? `${window.location.origin}/dashboard`
      : "/dashboard";
  }

  async function handleMagicLink() {
    const emailError = validateEmailInline(email);
    if (emailError) {
      setError(emailError);
      setStatus("error");
      return;
    }
    if (!tokenReady) {
      setError("Verifying you're human — one moment, then try again.");
      setStatus("error");
      return;
    }
    setStatus("sending");
    setError("");
    track("auth_magic_link_requested", { method: "magic_link" });
    try {
      const res = await fetch(`${API_URL}/api/auth/check-and-send-magic-link`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, turnstileToken: turnstileToken ?? "" }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setStatus("sent");
        track("auth_magic_link_sent");
      } else {
        setStatus("error");
        setError(data?.message ?? "Something went wrong. Please try again.");
      }
    } catch {
      setStatus("error");
      setError("Couldn't reach the server. Check your connection and try again.");
    }
  }

  async function handleGoogle() {
    track("auth_google_clicked");
    await signIn.social({ provider: "google", callbackURL: dashboardCallback() });
  }

  async function handlePasswordLogin() {
    const emailError = validateEmailInline(email);
    if (emailError) {
      setError(emailError);
      setStatus("error");
      return;
    }
    setStatus("sending");
    setError("");
    const result = await signIn.email({ email, password });
    if (result.error) {
      // Generic on purpose — never reveal whether the email exists.
      setStatus("error");
      setError("Incorrect email or password. Check your details and try again.");
      return;
    }
    if (result.data?.user?.id) identifyUser(result.data.user.id);
    router.push("/dashboard");
  }

  function togglePasswordMode() {
    setError("");
    setStatus("idle");
    if (!usePassword) track("auth_password_option_clicked");
    setUsePassword((v) => !v);
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden px-6 py-10">
      {/* Ambient amber glow behind the card */}
      <div
        aria-hidden
        className="pointer-events-none absolute left-1/2 top-[-10%] size-[600px] -translate-x-1/2 rounded-full bg-primary/10 blur-[140px]"
      />

      <div className="relative w-full max-w-[400px]">
        {/* Wordmark */}
        <Link
          href="/"
          className="mx-auto block w-fit text-2xl font-semibold tracking-tight font-[var(--font-display)] transition-opacity hover:opacity-80"
        >
          <span className="text-foreground">out</span>
          <span className="text-primary">rival</span>
        </Link>

        {/* Card */}
        <div className="mt-8 rounded-2xl border border-border bg-surface p-8 shadow-xl shadow-black/5">
          {status === "sent" ? (
            <SuccessState
              email={email}
              onReset={() => {
                setStatus("idle");
                setEmail("");
              }}
            />
          ) : (
            <>
              {/* Heading + amber accent */}
              <div className="mb-7 text-center">
                <h1 className="text-lg font-medium text-foreground">
                  Access your competitive intelligence
                </h1>
                <div className="mx-auto mt-3 h-0.5 w-8 bg-primary" />
              </div>

              <div className="flex flex-col gap-3">
                <Input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  onBlur={() => {
                    const msg = validateEmailInline(email);
                    if (msg) {
                      setError(msg);
                      setStatus("error");
                    } else if (status === "error") {
                      setError("");
                      setStatus("idle");
                    }
                  }}
                  placeholder="you@your-company.com"
                  autoComplete="email"
                  aria-label="Email address"
                />

                {usePassword ? (
                  <>
                    <Input
                      type="password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="Your password"
                      autoComplete="current-password"
                      aria-label="Password"
                    />
                    <Button
                      onClick={handlePasswordLogin}
                      disabled={!email || !password || status === "sending"}
                    >
                      {status === "sending" && <Loader2 size={14} className="animate-spin" />}
                      Sign in
                    </Button>
                  </>
                ) : (
                  <Button
                    onClick={handleMagicLink}
                    disabled={!email || status === "sending"}
                  >
                    {status === "sending" ? (
                      <Loader2 size={14} className="animate-spin" />
                    ) : (
                      <ArrowRight size={14} />
                    )}
                    {status === "sending" ? "Sending…" : "Send me a sign-in link"}
                  </Button>
                )}
              </div>

              {/* Divider */}
              <div className="my-6 flex items-center gap-3 text-xs text-muted-foreground">
                <div className="h-px flex-1 bg-border" />
                or
                <div className="h-px flex-1 bg-border" />
              </div>

              {/* Google */}
              <Button variant="outline" className="w-full" onClick={handleGoogle}>
                <GoogleIcon />
                Continue with Google
              </Button>

              {/* Password toggle */}
              <div className="mt-6 text-center">
                <button
                  type="button"
                  onClick={togglePasswordMode}
                  className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
                >
                  <CornerDownRight className="size-3.5" />
                  {usePassword ? "Use a magic link instead" : "Prefer a password?"}
                </button>
              </div>

              {status === "error" && error && (
                <p className="mt-4 text-center text-xs text-destructive" role="alert">
                  {error}
                </p>
              )}

              {/* Invisible Turnstile (managed) */}
              {turnstileRequired && (
                <div className="mt-6 flex justify-center">
                  <Turnstile
                    siteKey={TURNSTILE_SITE_KEY!}
                    options={{ appearance: "interaction-only" }}
                    onSuccess={setTurnstileToken}
                    onExpire={() => setTurnstileToken(null)}
                    onError={() => setTurnstileToken(null)}
                  />
                </div>
              )}
            </>
          )}
        </div>

        <p className="mt-6 text-center text-xs text-muted-foreground leading-relaxed">
          By continuing, you agree to our terms of service and privacy policy.
        </p>
      </div>
    </div>
  );
}

function SuccessState({ email, onReset }: { email: string; onReset: () => void }) {
  return (
    <div className="text-center">
      <div className="mx-auto flex size-11 items-center justify-center rounded-full bg-primary/10 text-primary">
        <Mail size={18} />
      </div>
      <h2 className="mt-5 text-base font-medium text-foreground">Check your email</h2>
      <p className="mt-2 text-sm text-muted-foreground leading-relaxed">
        If <span className="text-foreground">{email}</span> is a valid address, a
        sign-in link is on its way.
      </p>
      <p className="mt-2 text-xs text-muted-foreground">The link expires in 10 minutes.</p>
      <button
        type="button"
        onClick={onReset}
        className="mt-6 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        <ArrowLeft size={14} />
        Use a different email
      </button>
    </div>
  );
}

function GoogleIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 18 18" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62Z"
      />
      <path
        fill="#34A853"
        d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18Z"
      />
      <path
        fill="#FBBC05"
        d="M3.97 10.72A5.4 5.4 0 0 1 3.68 9c0-.6.1-1.18.29-1.72V4.95H.96A9 9 0 0 0 0 9c0 1.45.35 2.82.96 4.05l3.01-2.33Z"
      />
      <path
        fill="#EA4335"
        d="M9 3.58c1.32 0 2.5.46 3.44 1.35l2.58-2.58C13.46.89 11.43 0 9 0A9 9 0 0 0 .96 4.95l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58Z"
      />
    </svg>
  );
}
