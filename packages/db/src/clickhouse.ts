import { createClient, type ClickHouseClient } from "@clickhouse/client";

let client: ClickHouseClient | null = null;

export function getClickhouse(): ClickHouseClient {
  if (!client) {
    const url = process.env.CLICKHOUSE_URL;
    if (!url) {
      throw new Error("CLICKHOUSE_URL is required");
    }
    client = createClient({
      url,
      password: process.env.CLICKHOUSE_PASSWORD,
      database: process.env.CLICKHOUSE_DATABASE ?? "outrival",
      // ClickHouse Cloud idles to zero — a cold query can hang ~30s. Bound it so
      // a slow wake-up surfaces as a thrown error (caught → [] by chQuery)
      // instead of an indefinite hang on the request handler.
      request_timeout: 8000,
    });
  }
  return client;
}

export const ch = new Proxy({} as ClickHouseClient, {
  get(_target, prop) {
    const real = getClickhouse() as unknown as Record<string | symbol, unknown>;
    return real[prop];
  },
});
