"use client";

import { useEffect } from "react";
import * as Sentry from "@sentry/nextjs";

// Root error boundary (Next App Router idiom for a global ErrorBoundary). It
// replaces the root layout when an unhandled error escapes, so it ships its own
// <html>/<body> and inline styles — globals.css and the theme provider aren't
// mounted here. Reports to Sentry (patch-04) and shows a sober screen in three
// parts; NEVER a stack trace (patch-14).
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#0B0B0D",
          color: "rgba(255,255,255,0.95)",
          fontFamily:
            "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
          padding: "24px",
        }}
      >
        <div style={{ maxWidth: 420, textAlign: "center" }}>
          <h1 style={{ fontSize: 20, fontWeight: 600, margin: "0 0 8px", letterSpacing: "-0.01em" }}>
            Something went wrong
          </h1>
          <p style={{ fontSize: 14, lineHeight: 1.6, color: "rgba(255,255,255,0.60)", margin: "0 0 24px" }}>
            Our team has been notified and is looking into it. Reload the page, or
            head back to your dashboard.
          </p>
          <div style={{ display: "flex", gap: 8, justifyContent: "center", flexWrap: "wrap" }}>
            <button
              onClick={() => reset()}
              style={{
                background: "#46c7d6",
                color: "#121418",
                border: "none",
                borderRadius: 6,
                padding: "8px 16px",
                fontSize: 14,
                fontWeight: 500,
                cursor: "pointer",
              }}
            >
              Reload the page
            </button>
            <a
              href="/dashboard"
              style={{
                color: "rgba(255,255,255,0.95)",
                border: "1px solid rgba(255,255,255,0.14)",
                borderRadius: 6,
                padding: "8px 16px",
                fontSize: 14,
                textDecoration: "none",
              }}
            >
              Back to dashboard
            </a>
          </div>
          {error.digest && (
            <div style={{ marginTop: 16, fontSize: 11, fontFamily: "ui-monospace, monospace", color: "rgba(255,255,255,0.40)" }}>
              ref: {error.digest}
            </div>
          )}
        </div>
      </body>
    </html>
  );
}
