import { getClickhouse } from "@outrival/db";

export async function chQuery<T>(args: {
  query: string;
  params?: Record<string, unknown>;
}): Promise<T[]> {
  if (!process.env.CLICKHOUSE_URL) return [];
  try {
    const ch = getClickhouse();
    const result = await ch.query({
      query: args.query,
      query_params: args.params,
      format: "JSONEachRow",
    });
    return (await result.json()) as T[];
  } catch (err) {
    console.error("ClickHouse query failed:", err);
    return [];
  }
}
