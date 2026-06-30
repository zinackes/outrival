// Sentry MUST be imported first so the SDK can patch globals before anything
// else loads. Side-effect import — keep this at the top of the file.
import { Sentry } from "./lib/sentry";
import { Hono } from "hono";
import { getPostHog } from "./lib/posthog";
import { cors } from "hono/cors";
import { contextStorage } from "hono/context-storage";
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
import { battleCardsRouter, battleCardsListRouter } from "./routes/battle-cards";
import { notificationsRouter } from "./routes/notifications";
import { candidatesRouter } from "./routes/candidates";
import { billingRouter } from "./routes/billing";
import { stripeWebhookRouter } from "./routes/stripe-webhook";
import { feedbackRouter } from "./routes/feedback";
import { feedbackQualityRouter } from "./routes/feedback-quality";
import { digestFeedbackRouter } from "./routes/digest-feedback";
import { searchRouter } from "./routes/search";
import { myProductRouter } from "./routes/my-product";
import { productsRouter } from "./routes/products";
import { sectoralRouter } from "./routes/sectoral";
import { activityRouter } from "./routes/activity";
import { usageRouter } from "./routes/usage";
import { trendsRouter } from "./routes/trends";
import { aiVisibilityRouter } from "./routes/ai-visibility";
import { compareRouter } from "./routes/compare";
import { askRouter } from "./routes/ask";
import { savedViewsRouter } from "./routes/saved-views";
import { crmDestinationsRouter } from "./routes/crm-destinations";
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

// Expose the current request's Context to non-handler code via getContext()
// (hono/context-storage). The auth middleware stamps the resolved orgId on it so
// ensureUserOrg can skip its second users round-trip on every authenticated call.
app.use("*", contextStorage());
app.use("*", honoLogger());
app.use(
  "*",
  cors({
    origin:
      env.NODE_ENV === "production"
        ? [process.env.WEB_URL ?? "https://outrival.app"]
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
app.route("/api/battle-cards", battleCardsListRouter);
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
app.route("/api/products", productsRouter);
app.route("/api/sectoral", sectoralRouter);
app.route("/api/activity", activityRouter);
app.route("/api/usage", usageRouter);
app.route("/api/trends", trendsRouter);
app.route("/api/ai-visibility", aiVisibilityRouter);
app.route("/api/compare", compareRouter);
app.route("/api/ask", askRouter);
app.route("/api/saved-views", savedViewsRouter);
app.route("/api/crm-destinations", crmDestinationsRouter);
app.route("/api/system", systemRouter);
app.route("/api/monitor-alternatives", monitorAlternativesRouter);
app.route("/api/manual-snapshots", manualSnapshotsRouter);
app.route("/api/structural-changes", structuralChangesRouter);
app.route("/api/ai-quality", aiQualityRouter);
app.route("/api/admin", adminRouter);

// DEV-ONLY — manual cron trigger console. Strict equality: NODE_ENV defaults
// to "development" when unset, so `!== "production"` would mount these on a
// deployment that forgot the env var (fail-open).
if (env.NODE_ENV === "development") {
  app.route("/api/dev", devRouter);
}

app.onError((err, c) => {
  Sentry.captureException(err);
  getPostHog()?.captureException(err);
  logger.error(
    { err, path: c.req.path, method: c.req.method },
    "Unhandled error",
  );
  return c.json({ error: "Internal server error" }, 500);
});

export default {
  port: env.PORT,
  // Synchronous discovery (`POST /api/candidates/detect`) runs Exa + reachability
  // checks and is designed to take up to ~15s. Bun's default idleTimeout is 10s,
  // which severed the socket mid-request (200 logged at 12s). Bump it past the
  // discovery budget. Value is in seconds (max 255).
  idleTimeout: 30,
  fetch: app.fetch,
};
