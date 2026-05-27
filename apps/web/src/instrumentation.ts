import * as Sentry from "@sentry/nextjs";

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs" || process.env.NEXT_RUNTIME === "edge") {
    Sentry.init({
      dsn: process.env.SENTRY_DSN_WEB,
      environment: process.env.NODE_ENV,
      enabled: process.env.NODE_ENV === "production",
      tracesSampleRate: 0.1,
      sendDefaultPii: false,
    });
  }
}

export { captureRequestError as onRequestError } from "@sentry/nextjs";
