// Server-side Cloudflare Turnstile verification. In dev without a secret key the
// check is bypassed (logged) so local auth works without a Turnstile site.

export async function verifyTurnstileToken(
  token: string | undefined,
  ip: string | null,
): Promise<boolean> {
  const secret = process.env.TURNSTILE_SECRET_KEY;
  if (!secret) {
    console.warn("TURNSTILE_SECRET_KEY not set — bypassing verification (dev only)");
    return true;
  }
  if (!token) return false;

  try {
    const response = await fetch(
      "https://challenges.cloudflare.com/turnstile/v0/siteverify",
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        // remoteip is optional and must be a real address when sent — omit it
        // rather than pass the old "unknown" placeholder, which Cloudflare
        // treats as a malformed request.
        body: new URLSearchParams({
          secret,
          response: token,
          ...(ip ? { remoteip: ip } : {}),
        }),
        signal: AbortSignal.timeout(5000),
      },
    );
    const result = (await response.json()) as { success?: boolean };
    return result.success === true;
  } catch {
    return false;
  }
}
