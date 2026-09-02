import pino, { type LoggerOptions } from "pino";

const isDev = process.env.NODE_ENV === "development";

// Exported so the redaction rules can be verified against pino itself rather than
// re-read by eye: they are the only thing standing between a `logger.info({ user })`
// and a session token in the log drain.
export const baseOptions: LoggerOptions = {
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

function createLogger() {
  if (!isDev) return pino(baseOptions);
  try {
    return pino({
      ...baseOptions,
      transport: { target: "pino-pretty", options: { colorize: true } },
    });
  } catch {
    // Some runtimes (e.g. the `trigger dev` indexer) cannot spin up the
    // pino-pretty transport worker and throw at construction. Fall back to
    // plain pino rather than crashing every job's module import.
    return pino(baseOptions);
  }
}

export const logger = createLogger();
