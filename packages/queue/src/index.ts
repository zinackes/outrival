// @outrival/queue — pg-boss v12 job runner shared by api (send) + workers (work).
export {
  startQueue,
  stopQueue,
  getBoss,
  registerQueues,
  defineJob,
  work,
  jobData,
  NonRetriable,
  DeadLetter,
  isAbortedOutput,
  isDeadLetteredOutput,
  deadLetterPayload,
  type AbortedOutput,
  type DeadLetteredOutput,
  type DeadLetterEnvelope,
  type QueueMode,
  type JobConfig,
  type JobDef,
} from "./boss";
// Re-exported so worker handlers can type a job's metadata (retryCount/retryLimit —
// how the scrape-monitor onFailure hook detects its terminal attempt) without every
// app taking a direct pg-boss dependency.
export type { Job, JobWithMetadata } from "pg-boss";
export * from "./jobs";
