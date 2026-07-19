import { logger as base } from "@outrival/shared";

// Trigger.dev's `logger` is message-first (`logger.log("msg", { meta })`); the
// neutral @outrival/shared logger is pino-style object-first (`info({ meta }, "msg")`).
// This shim exposes the Trigger surface on top of the neutral logger so a job body
// can move from Trigger's runtime into a pg-boss core handler with its log calls
// UNCHANGED — only the import line swaps. Outlives the Trigger cutover: the core
// bodies keep calling it.
type Meta = Record<string, unknown>;

export const logger = {
  log: (message: string, metadata?: Meta) => base.info(metadata ?? {}, message),
  info: (message: string, metadata?: Meta) => base.info(metadata ?? {}, message),
  warn: (message: string, metadata?: Meta) => base.warn(metadata ?? {}, message),
  error: (message: string, metadata?: Meta) => base.error(metadata ?? {}, message),
  debug: (message: string, metadata?: Meta) => base.debug(metadata ?? {}, message),
  trace: (message: string, metadata?: Meta) => base.debug(metadata ?? {}, message),
};
