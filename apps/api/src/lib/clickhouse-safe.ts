import { getClickhouse } from "@outrival/db";
import { logger } from "@outrival/shared";

// Hard ceiling for the whole query, including the connect/TLS phase that the
// client's request_timeout may not cover when the Cloud service is cold. Sits
// above the client request_timeout (8s) so the client normally aborts first;
// this race is the safety net that guarantees the handler never hangs.
const QUERY_DEADLINE_MS = 10_000;

export async function chQuery<T>(args: {
  query: string;
  params?: Record<string, unknown>;
}): Promise<T[]> {
  if (!process.env.CLICKHOUSE_URL) return [];

  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<T[]>((resolve) => {
    timer = setTimeout(() => {
      logger.error({ query: args.query }, "ClickHouse query timed out");
      resolve([]);
    }, QUERY_DEADLINE_MS);
  });

  const run = (async () => {
    const ch = getClickhouse();
    const result = await ch.query({
      query: args.query,
      query_params: args.params,
      format: "JSONEachRow",
    });
    return (await result.json()) as T[];
  })();

  try {
    return await Promise.race([run, deadline]);
  } catch (err) {
    logger.error({ err, query: args.query }, "ClickHouse query failed");
    return [];
  } finally {
    if (timer) clearTimeout(timer);
  }
}
