import { task, logger } from "@trigger.dev/sdk/v3";

export const helloWorldJob = task({
  id: "hello-world",
  async run(payload: { message: string }) {
    logger.log("Hello from Outrival workers!", { message: payload.message });
    await new Promise((resolve) => setTimeout(resolve, 1000));
    logger.log("Job completed successfully");
    return { ok: true, echo: payload.message };
  },
});
