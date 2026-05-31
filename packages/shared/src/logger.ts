import pino, { type LoggerOptions } from "pino";

const isDev = process.env.NODE_ENV === "development";

const baseOptions: LoggerOptions = {
  level: process.env.LOG_LEVEL ?? "info",
  redact: {
    paths: [
      "*.password",
      "*.token",
      "*.apiKey",
      "*.api_key",
      "*.secret",
      "*.authorization",
      "req.headers.authorization",
      "req.headers.cookie",
      "*.email",
      "*.stripeCustomerId",
      "DATABASE_URL",
      // Never let uploaded document bytes / multipart bodies reach the logs
      // (zero-storage guarantee for the document onboarding mode).
      "req.body",
      "*.file",
    ],
    censor: "[REDACTED]",
  },
};

export const logger = isDev
  ? pino({
      ...baseOptions,
      transport: { target: "pino-pretty", options: { colorize: true } },
    })
  : pino(baseOptions);

export function childLogger(context: Record<string, unknown>) {
  return logger.child(context);
}
