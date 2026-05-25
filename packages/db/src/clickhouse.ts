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
      database: process.env.CLICKHOUSE_DATABASE ?? "default",
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
