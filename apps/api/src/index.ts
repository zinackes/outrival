import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { env } from "./env";
import { auth } from "./lib/auth";
import { healthRouter } from "./routes/health";

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

app.route("/health", healthRouter);

export default {
  port: env.PORT,
  fetch: app.fetch,
};
