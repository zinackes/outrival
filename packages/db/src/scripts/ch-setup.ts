import { config } from "dotenv";
import { ensureClickhouseTables } from "../clickhouse-schema";

config({ path: "../../.env.local" });

async function main() {
  console.log("Ensuring ClickHouse tables exist...");
  await ensureClickhouseTables();
  console.log(
    "✓ pricing_history, job_counts, review_scores, signal_feed, scrape_runs, ai_runs, numeric_claims, tech_stack_history",
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("ch:setup failed:", err);
    process.exit(1);
  });
