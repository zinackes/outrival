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
