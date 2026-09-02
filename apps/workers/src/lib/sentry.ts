import * as Sentry from "@sentry/node";
import type { ErrorEvent, EventHint } from "@sentry/node";
import { queryFailure } from "@outrival/shared";

// Every `Failed query` reaching Sentry looks the same: drizzle titles it with the
// SQL, and the driver error underneath survives only as a name and a message. The
// SQLSTATE code and the routine that raised it — a prepared statement missing on
// the pooled connection, a statement timeout, an exhausted pool — are dropped on
// the way out, which is why ~859 of them over 30 days sat in one bucket with no way
// to tell which (OUT-258). `queryFailure` keeps the deciding fields and none of the
// ones that quote the offending row.
function annotateQueryFailure(event: ErrorEvent, hint: EventHint): void {
  const failure = queryFailure(hint.originalException);
  if (!failure) return;
  event.tags = { ...event.tags, "pg.code": failure.code };
  if (failure.routine) event.tags["pg.routine"] = failure.routine;
  event.contexts = { ...event.contexts, postgres: { ...failure } };
}

Sentry.init({
  dsn: process.env.SENTRY_DSN_WORKERS,
  environment: process.env.NODE_ENV,
  enabled: process.env.NODE_ENV === "production",
  tracesSampleRate: 0.1,
  sendDefaultPii: false,
  beforeSend(event, hint) {
    annotateQueryFailure(event, hint);
    return event;
  },
});

export { Sentry };
