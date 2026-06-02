// Sentry MUST be imported first so the SDK can patch globals before anything
// else loads. Side-effect import — keep this at the top of the file.
import { Sentry } from "./lib/sentry";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger as honoLogger } from "hono/logger";
import { logger } from "@outrival/shared";
import { env } from "./env";
import { auth } from "./lib/auth";
import { healthRouter } from "./routes/health";
import { competitorsRouter } from "./routes/competitors";
import { monitorsRouter } from "./routes/monitors";
import { changesRouter } from "./routes/changes";
import { signalsRouter } from "./routes/signals";
import { digestsRouter } from "./routes/digests";
import { settingsRouter } from "./routes/settings";
import { onboardingRouter } from "./routes/onboarding";
import { onboardingSessionRouter } from "./routes/onboarding-session";
import { battleCardsRouter } from "./routes/battle-cards";
import { notificationsRouter } from "./routes/notifications";
import { candidatesRouter } from "./routes/candidates";
import { billingRouter } from "./routes/billing";
import { stripeWebhookRouter } from "./routes/stripe-webhook";
import { feedbackRouter } from "./routes/feedback";
import { feedbackQualityRouter } from "./routes/feedback-quality";
import { digestFeedbackRouter } from "./routes/digest-feedback";
import { searchRouter } from "./routes/search";
import { myProductRouter } from "./routes/my-product";
import { sectoralRouter } from "./routes/sectoral";
import { systemRouter } from "./routes/system";
import { adminRouter } from "./routes/admin";
import { devRouter } from "./routes/dev";
import { authRouter } from "./routes/auth";
import { monitorAlternativesRouter } from "./routes/monitor-alternatives";
import { manualSnapshotsRouter } from "./routes/manual-snapshots";
import { structuralChangesRouter } from "./routes/structural-changes";
import { aiQualityRouter } from "./routes/ai-quality";
import { notificationPreferencesRouter } from "./routes/notification-preferences";

const app = new Hono();

app.use("*", honoLogger());
app.use(
  "*",
  cors({
    origin:
      env.NODE_ENV === "production"
        ? ["https://outrival.io"]
        : ["http://localhost:3000"],
    credentials: true,
  }),
);

// Custom auth flow routes (patch-19). MUST be registered before Better Auth's
// catch-all below, or the wildcard handler swallows them.
app.route("/api/auth", authRouter);

app.on(["POST", "GET"], "/api/auth/*", (c) => auth.handler(c.req.raw));

// Stripe webhook — must be mounted before any router that could consume the
// body (none currently, but kept first defensively) and stays outside the
// auth middleware: Stripe authenticates the request via its signature.
app.route("/api/stripe/webhook", stripeWebhookRouter);

app.route("/health", healthRouter);
app.route("/api/competitors", competitorsRouter);
app.route("/api/competitors", battleCardsRouter);
app.route("/api/monitors", monitorsRouter);
app.route("/api/changes", changesRouter);
app.route("/api/signals", signalsRouter);
app.route("/api/digests", digestsRouter);
app.route("/api/settings", settingsRouter);
app.route("/api/onboarding", onboardingRouter);
app.route("/api/onboarding-session", onboardingSessionRouter);
app.route("/api/notifications", notificationsRouter);
app.route("/api/notification-preferences", notificationPreferencesRouter);
app.route("/api/candidates", candidatesRouter);
app.route("/api/billing", billingRouter);
app.route("/api/feedback", feedbackRouter);
app.route("/api/feedback-quality", feedbackQualityRouter);
// Public (token-authenticated) digest email feedback — no session middleware.
app.route("/api/digest-feedback", digestFeedbackRouter);
app.route("/api/search", searchRouter);
app.route("/api/my-product", myProductRouter);
app.route("/api/sectoral", sectoralRouter);
app.route("/api/system", systemRouter);
app.route("/api/monitor-alternatives", monitorAlternativesRouter);
app.route("/api/manual-snapshots", manualSnapshotsRouter);
app.route("/api/structural-changes", structuralChangesRouter);
app.route("/api/ai-quality", aiQualityRouter);
app.route("/api/admin", adminRouter);

// DEV-ONLY — manual cron trigger console. Never mounted in production; remove
// this block and ./routes/dev.ts before shipping.
if (env.NODE_ENV !== "production") {
  app.route("/api/dev", devRouter);
}

app.onError((err, c) => {
  Sentry.captureException(err);
  logger.error(
    { err, path: c.req.path, method: c.req.method },
    "Unhandled error",
  );
  return c.json({ error: "Internal server error" }, 500);
});

export default {
  port: env.PORT,
  fetch: app.fetch,
};
