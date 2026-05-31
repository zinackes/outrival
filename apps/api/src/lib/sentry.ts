import * as Sentry from "@sentry/node";

Sentry.init({
  dsn: process.env.SENTRY_DSN_API,
  environment: process.env.NODE_ENV,
  enabled: process.env.NODE_ENV === "production",
  tracesSampleRate: 0.1,
  sendDefaultPii: false,
  // Zero-storage guarantee for the document onboarding mode: never let the
  // uploaded file's bytes reach Sentry, even if an error is captured mid-request.
  beforeSend(event) {
    if (event.request?.url?.includes("/onboarding/analyze-document")) {
      if (event.request) event.request.data = "[REDACTED — document upload]";
    }
    return event;
  },
});

export { Sentry };
