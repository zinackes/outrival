import { AbortTaskRunError } from "@trigger.dev/sdk/v3";
import { NonRetriable } from "@outrival/queue";

// Bridge a runtime-neutral job body (in src/core/*, which throws `NonRetriable`
// for terminal/expected failures) into the Trigger.dev runner during the
// coexistence window: translate NonRetriable → AbortTaskRunError so Trigger stops
// retrying a job that pg-boss would complete-without-retry. The pg-boss `work`
// wrapper already honors NonRetriable natively, so core handlers are called
// directly there. Deleted together with the Trigger wrappers in Phase 7.
export function asTriggerRun<P, R>(fn: (payload: P) => Promise<R>) {
  return async (payload: P): Promise<R> => {
    try {
      return await fn(payload);
    } catch (err) {
      if (err instanceof NonRetriable) throw new AbortTaskRunError(err.message);
      throw err;
    }
  };
}
