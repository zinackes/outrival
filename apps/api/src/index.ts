import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
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
import { battleCardsRouter } from "./routes/battle-cards";
import { notificationsRouter } from "./routes/notifications";
import { candidatesRouter } from "./routes/candidates";
import { billingRouter } from "./routes/billing";
import { stripeWebhookRouter } from "./routes/stripe-webhook";

const app = new Hono();

app.use("*", logger());
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

app.on(["POST", "GET"], "/api/auth/**", (c) => auth.handler(c.req.raw));

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
app.route("/api/notifications", notificationsRouter);
app.route("/api/candidates", candidatesRouter);
app.route("/api/billing", billingRouter);

export default {
  port: env.PORT,
  fetch: app.fetch,
};
