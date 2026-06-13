"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Turnstile, type TurnstileInstance } from "@marsidev/react-turnstile";
import { ArrowLeft, ArrowRight, CornerDownRight, Loader2, Mail } from "lucide-react";
import { emailSchema } from "@outrival/shared";
import { signIn } from "@/lib/auth-client";
import { track, identifyUser } from "@/lib/posthog/events";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

const RESEND_COOLDOWN_SECONDS = 30;

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "";
const TURNSTILE_SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;

type Step = "email" | "code";
type Status = "idle" | "loading" | "error";

function validateEmailInline(email: string): string | null {
  if (!email) return null;
  const result = emailSchema.safeParse(email);
  return result.success ? null : (result.error.issues[0]?.message ?? "Invalid email");
}

export function AuthForm() {
  const router = useRouter();
  const turnstileRef = useRef<TurnstileInstance | null>(null);
  const [step, setStep] = useState<Step>("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const [usePassword, setUsePassword] = useState(false);
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState("");
  const [cooldown, setCooldown] = useState(0);

  const turnstileRequired = Boolean(TURNSTILE_SITE_KEY);
  const tokenReady = !turnstileRequired || Boolean(turnstileToken);

  // Surface server-side redirect failures back onto /auth:
  //  - link_invalid → the one-click link (GET /api/auth/otp-link) failed.
  //  - any other ?error= → Better Auth's Google OAuth callback failed.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const reason = new URLSearchParams(window.location.search).get("error");
    if (!reason) return;
    setStatus("error");
    setError(
      reason === "link_invalid"
        ? "That sign-in link is invalid or expired. Enter your email to get a new code."
        : "Google sign-in didn't complete. Try again, or continue with your email.",
    );
    window.history.replaceState(null, "", window.location.pathname);
  }, []);

  // Resend cooldown countdown.
  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  function dashboardCallback(): string {
    return typeof window !== "undefined"
      ? `${window.location.origin}/dashboard`
      : "/dashboard";
  }

  async function handleSendCode() {
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
    setStatus("loading");
    setError("");
    track("auth_magic_link_requested", { method: "email_otp" });
    try {
      const res = await fetch(`${API_URL}/api/auth/check-and-send-magic-link`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, turnstileToken: turnstileToken ?? "" }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setStep("code");
        setStatus("idle");
        setCooldown(RESEND_COOLDOWN_SECONDS);
        track("auth_magic_link_sent");
      } else {
        setStatus("error");
        setError(data?.message ?? "Something went wrong. Please try again.");
      }
    } catch {
      setStatus("error");
      setError("Couldn't reach the server. Check your connection and try again.");
    } finally {
      // Turnstile tokens are single-use; refresh so a resend has a fresh one.
      turnstileRef.current?.reset();
    }
  }

  async function handleVerifyCode(otp = code) {
    if (otp.length < 6) return;
    setStatus("loading");
    setError("");
    try {
      // Better Auth emailOTP sign-in endpoint — creates the account when the email
      // is new, signs in when it exists (transparent). credentials:"include" so the
      // session cookie is set cross-subdomain, exactly like the client would.
      const res = await fetch(`${API_URL}/api/auth/sign-in/email-otp`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, otp }),
      });
      const data = (await res.json().catch(() => ({}))) as { user?: { id?: string } };
      if (!res.ok) {
        setStatus("error");
        setError("That code is invalid or expired. Check your email or request a new one.");
        return;
      }
      track("auth_code_verified");
      if (data?.user?.id) identifyUser(data.user.id);
      router.push("/dashboard");
    } catch {
      setStatus("error");
      setError("Couldn't reach the server. Check your connection and try again.");
    }
  }

  async function handleGoogle() {
    track("auth_google_clicked");
    const origin = typeof window !== "undefined" ? window.location.origin : "";
    await signIn.social({
      provider: "google",
      callbackURL: dashboardCallback(),
      errorCallbackURL: `${origin}/auth?error=oauth_failed`,
    });
  }

  async function handlePasswordLogin() {
    const emailError = validateEmailInline(email);
    if (emailError) {
      setError(emailError);
      setStatus("error");
      return;
    }
    setStatus("loading");
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

  function resetToEmail() {
    setStep("email");
    setCode("");
    setStatus("idle");
    setError("");
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
          {step === "code" ? (
            <CodeStep
              email={email}
              code={code}
              status={status}
              error={error}
              cooldown={cooldown}
              onCodeChange={(value) => {
                setCode(value);
                if (status === "error") {
                  setError("");
                  setStatus("idle");
                }
              }}
              onVerify={(otp) => void handleVerifyCode(otp)}
              onResend={() => void handleSendCode()}
              onBack={resetToEmail}
            />
          ) : (
            <>
              {/* Heading + amber accent */}
              <div className="mb-7 text-center">
                <h1 className="text-lg font-medium text-foreground">
                  Sign in or create your account
                </h1>
                <p className="mt-1.5 text-sm text-muted-foreground">
                  One step — we'll email you a code, no password to remember.
                </p>
                <div className="mx-auto mt-3 h-0.5 w-8 bg-primary" />
              </div>

              {/* Google first */}
              <Button variant="outline" className="w-full" onClick={handleGoogle}>
                <GoogleIcon />
                Continue with Google
              </Button>

              {/* Divider */}
              <div className="my-6 flex items-center gap-3 text-xs text-muted-foreground">
                <div className="h-px flex-1 bg-border" />
                or
                <div className="h-px flex-1 bg-border" />
              </div>

              <div className="flex flex-col gap-3">
                <Input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !usePassword) void handleSendCode();
                  }}
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
                      disabled={!email || !password || status === "loading"}
                    >
                      {status === "loading" && <Loader2 size={14} className="animate-spin" />}
                      Sign in
                    </Button>
                  </>
                ) : (
                  <Button onClick={handleSendCode} disabled={!email || status === "loading"}>
                    {status === "loading" ? (
                      <Loader2 size={14} className="animate-spin" />
                    ) : (
                      <ArrowRight size={14} />
                    )}
                    {status === "loading" ? "Sending…" : "Continue with email"}
                  </Button>
                )}
              </div>

              {/* Password toggle */}
              <div className="mt-6 text-center">
                <button
                  type="button"
                  onClick={togglePasswordMode}
                  className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
                >
                  <CornerDownRight className="size-3.5" />
                  {usePassword ? "Email me a code instead" : "Prefer a password?"}
                </button>
              </div>

              {status === "error" && error && (
                <p className="mt-4 text-center text-xs text-destructive" role="alert">
                  {error}
                </p>
              )}
            </>
          )}
        </div>

        {/* Invisible Turnstile (managed) — kept mounted across steps so a resend
            always has a fresh, single-use token. */}
        {turnstileRequired && (
          <div className="mt-6 flex justify-center">
            <Turnstile
              ref={turnstileRef}
              siteKey={TURNSTILE_SITE_KEY!}
              options={{ appearance: "interaction-only" }}
              onSuccess={setTurnstileToken}
              onExpire={() => setTurnstileToken(null)}
              onError={() => setTurnstileToken(null)}
            />
          </div>
        )}

        <p className="mt-6 text-center text-xs text-muted-foreground leading-relaxed">
          By continuing, you agree to our{" "}
          <Link
            href="/terms"
            target="_blank"
            className="underline underline-offset-2 hover:text-foreground"
          >
            terms of service
          </Link>{" "}
          and{" "}
          <Link
            href="/privacy"
            target="_blank"
            className="underline underline-offset-2 hover:text-foreground"
          >
            privacy policy
          </Link>
          .
        </p>
      </div>
    </div>
  );
}

function CodeStep({
  email,
  code,
  status,
  error,
  cooldown,
  onCodeChange,
  onVerify,
  onResend,
  onBack,
}: {
  email: string;
  code: string;
  status: Status;
  error: string;
  cooldown: number;
  onCodeChange: (value: string) => void;
  onVerify: (otp: string) => void;
  onResend: () => void;
  onBack: () => void;
}) {
  const invalid = status === "error" && Boolean(error);
  return (
    <div className="text-center">
      <div className="mx-auto flex size-11 items-center justify-center rounded-full bg-primary/10 text-primary">
        <Mail size={18} />
      </div>
      <h2 className="mt-5 text-base font-medium text-foreground">Check your email</h2>
      <p className="mt-2 text-sm text-muted-foreground leading-relaxed">
        We sent a 6-digit code to <span className="text-foreground">{email}</span>.
        Enter it below, or click the link in the email to sign in here.
      </p>

      <OtpInput
        value={code}
        onChange={onCodeChange}
        onComplete={onVerify}
        disabled={status === "loading"}
        invalid={invalid}
      />

      <Button
        className="mt-4 w-full"
        onClick={() => onVerify(code)}
        disabled={code.length < 6 || status === "loading"}
      >
        {status === "loading" && <Loader2 size={14} className="animate-spin" />}
        Verify and continue
      </Button>

      {invalid && (
        <p className="mt-4 text-xs text-destructive" role="alert">
          {error}
        </p>
      )}

      <p className="mt-6 text-xs text-muted-foreground">The code expires in 10 minutes.</p>

      <div className="mt-4 flex items-center justify-center gap-4">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft size={14} />
          Use a different email
        </button>
        <span className="text-border" aria-hidden>
          |
        </span>
        <button
          type="button"
          onClick={onResend}
          disabled={status === "loading" || cooldown > 0}
          className="text-sm text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50 disabled:hover:text-muted-foreground"
        >
          {cooldown > 0 ? `Resend in ${cooldown}s` : "Resend code"}
        </button>
      </div>
    </div>
  );
}

/**
 * Six single-character boxes backing one OTP string. Invariant: no gaps — typing
 * advances focus, backspace clears the current box then steps back, and a paste
 * distributes up to 6 digits. autoComplete="one-time-code" lets the OS surface
 * the emailed code.
 */
function OtpInput({
  value,
  onChange,
  onComplete,
  disabled,
  invalid,
}: {
  value: string;
  onChange: (v: string) => void;
  onComplete: (v: string) => void;
  disabled?: boolean;
  invalid?: boolean;
}) {
  const refs = useRef<Array<HTMLInputElement | null>>([]);

  function commit(next: string): string {
    const clean = next.replace(/\D/g, "").slice(0, 6);
    onChange(clean);
    if (clean.length === 6) onComplete(clean);
    return clean;
  }

  function handleChange(i: number, raw: string) {
    const digit = raw.replace(/\D/g, "").slice(-1);
    if (!digit) return;
    commit(value.slice(0, i) + digit + value.slice(i + 1));
    refs.current[Math.min(i + 1, 5)]?.focus();
  }

  function handleKeyDown(i: number, e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Backspace") {
      e.preventDefault();
      if (value[i]) {
        commit(value.slice(0, i) + value.slice(i + 1));
      } else if (i > 0) {
        commit(value.slice(0, i - 1) + value.slice(i));
        refs.current[i - 1]?.focus();
      }
    } else if (e.key === "ArrowLeft" && i > 0) {
      refs.current[i - 1]?.focus();
    } else if (e.key === "ArrowRight" && i < 5) {
      refs.current[i + 1]?.focus();
    }
  }

  function handlePaste(e: React.ClipboardEvent<HTMLDivElement>) {
    e.preventDefault();
    const pasted = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, 6);
    if (!pasted) return;
    const clean = commit(pasted);
    refs.current[Math.min(clean.length, 5)]?.focus();
  }

  return (
    <div className="mt-6 flex justify-center gap-2" onPaste={handlePaste}>
      {Array.from({ length: 6 }).map((_, i) => (
        <input
          key={i}
          ref={(el) => {
            refs.current[i] = el;
          }}
          value={value[i] ?? ""}
          onChange={(e) => handleChange(i, e.target.value)}
          onKeyDown={(e) => handleKeyDown(i, e)}
          onFocus={(e) => e.target.select()}
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={1}
          disabled={disabled}
          autoFocus={i === 0}
          aria-label={`Digit ${i + 1}`}
          className={cn(
            "size-12 rounded-lg border bg-background text-center text-xl font-mono tabular-nums slashed-zero text-foreground outline-none transition-colors",
            "focus:border-ring focus:ring-2 focus:ring-ring/30",
            invalid ? "border-destructive" : "border-border",
            disabled && "opacity-50",
          )}
        />
      ))}
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
