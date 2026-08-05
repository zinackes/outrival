import {
  pgTable,
  text,
  timestamp,
  pgEnum,
  jsonb,
  integer,
  doublePrecision,
  index,
} from "drizzle-orm/pg-core";
import { monitors } from "./monitors";

export const snapshotStatusEnum = pgEnum("snapshot_status", [
  "success", "failed", "partial",
]);

export const snapshots = pgTable("snapshots", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  monitorId: text("monitor_id").notNull().references(() => monitors.id, { onDelete: "cascade" }),
  r2Key: text("r2_key").notNull(),
  contentHash: text("content_hash").notNull(),
  status: snapshotStatusEnum("status").notNull().default("success"),
  scrapedAt: timestamp("scraped_at").notNull().defaultNow(),
  // HTTP validators for conditional fetch (etag / last-modified). resolvedUrl is
  // the exact URL this snapshot's content came from (scrapers do path discovery),
  // so the next conditional pre-flight checks the right resource.
  etag: text("etag"),
  lastModified: text("last_modified"),
  resolvedUrl: text("resolved_url"),
  // Semantic structure of a homepage capture (patch-16): hero, sections, nav,
  // footer, social proof. Present only for homepage snapshots scraped post-patch;
  // null for other sources and for pre-patch snapshots (diff falls back to lexical
  // for one iteration). Typed as HomepageStructure from @outrival/scrapers at the
  // call site — kept untyped here so @outrival/db stays a leaf package.
  homepageStructure: jsonb("homepage_structure"),
  // Perceptual (dHash) of the screenshot as a hex string (patch-17): catches a
  // visual redesign the text diff misses. Homepage snapshots with a screenshot only.
  screenshotPhash: text("screenshot_phash"),
  // Char length of the extracted visible content (patch-17): feeds the anti-void
  // median guard. Populated on every snapshot post-patch; null for older rows.
  contentSize: integer("content_size"),
  // Provenance (L2 archive backfill). "live" = captured by our scraper cascade;
  // "archive" = reconstructed from the Wayback Machine at onboarding to bootstrap
  // day-0 change value. Archive rows carry a backdated scrapedAt (the capture time)
  // and are invisible to normal latest-snapshot diffing (older than any live row);
  // generate-signal reads it to keep an archive-derived signal in-app only.
  origin: text("origin").notNull().default("live"),
  // R1 completeness score (Véracité Intelligence v2 P1) — 0..1, the grade this
  // capture got from @outrival/scrapers/completeness. Below its threshold the row
  // is stored `partial`, which is the enforceable half; this column is the reason
  // WHY, kept so a degraded monitor is queryable instead of only greppable in the
  // worker logs. Null on rows written before P1 and whenever the grader is off.
  completeness: doublePrecision("completeness"),
  // Provenance of the capture (P1). Generalises the vocabulary price_points.method
  // established: where a number came from changes how much it is worth. Written on
  // every new snapshot, never backfilled — a null means "captured before P1", not
  // "unknown method".
  //   static   — L0 plain fetch, no browser
  //   rendered — a browser served it (L1, or L2 with datacenter egress)
  //   feed     — an RSS/Atom/sitemap/JSON feed parsed into a synthetic document
  //   api      — the page's own runtime API captured (apiCaptureEnabled monitors)
  captureMethod: text("capture_method"),
  // Where we stood when we captured. Prices, availability and even copy are
  // geo-dependent, and the pricing pipeline already carries an observed_region it
  // stamps onto every batch — hoisted to the capture itself so every source has it.
  observedRegion: text("observed_region"),
  // The URL R6's "did we land where we asked" assertion was evaluated against —
  // the post-redirect landing URL at capture time. It carries the SAME value as
  // resolvedUrl today, and is kept separate on purpose: resolvedUrl is scraper-
  // owned (a source rewrites it during its own path discovery, so it answers
  // "which page did we decide to scrape"), while this one is the worker's record
  // of where the bytes came from. Without it, a scraper that starts rewriting
  // resolvedUrl silently rewrites the evidence behind every past redirect verdict.
  finalUrl: text("final_url"),
  // HTTP status the body was served with. A 4xx/5xx captured as content is the
  // audit's clearest lying success; storing it makes the claim checkable after
  // the fact rather than only at capture time.
  httpStatus: integer("http_status"),
}, (t) => [
  // Every scrape fetches the previous snapshot: latest per monitor.
  index("snapshots_monitor_scraped_idx").on(t.monitorId, t.scrapedAt),
]);
