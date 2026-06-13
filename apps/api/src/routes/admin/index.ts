import { Hono } from "hono";
import { authMiddleware } from "../../middleware/auth";
import { adminMiddleware } from "../../middleware/admin";
import type { AdminVariables } from "./shared";
import { overviewRouter } from "./overview";
import { scrapingRouter } from "./scraping";
import { aiRouter } from "./ai";
import { costRouter } from "./cost";
import { jobsRouter } from "./jobs";
import { usersRouter } from "./users";
import { feedbackRouter } from "./feedback";
import { notificationsRouter } from "./notifications";
import { productRouter } from "./product";
import { systemRouter } from "./system";

// Ops dashboard API, split by domain (one sub-router per /admin page area).
// Every sub-router inherits the two gates below — auth FIRST (sets
// c.get("user")), THEN the email-allowlist admin gate.
export const adminRouter = new Hono<{ Variables: AdminVariables }>();

adminRouter.use("*", authMiddleware);
adminRouter.use("*", adminMiddleware);

adminRouter.route("/", overviewRouter);
adminRouter.route("/", scrapingRouter);
adminRouter.route("/", aiRouter);
adminRouter.route("/", costRouter);
adminRouter.route("/", jobsRouter);
adminRouter.route("/", usersRouter);
adminRouter.route("/", feedbackRouter);
adminRouter.route("/", notificationsRouter);
adminRouter.route("/", productRouter);
adminRouter.route("/", systemRouter);
