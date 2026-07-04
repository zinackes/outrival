// Build provenance for the running web bundle. `NEXT_PUBLIC_BUILD_SHA` /
// `NEXT_PUBLIC_BUILD_TIME` are inlined at `next build` time from the GIT_SHA /
// BUILD_TIME Docker build args (see apps/web/Dockerfile), so hitting
// https://outrival.app/api/version returns the exact commit the LIVE web
// container was built from — a 2-second check that a deploy actually shipped,
// instead of guessing whether the served bundle is stale.
//
// `no-store` + force-dynamic so no CDN/proxy ever caches this across deploys and
// masks a stale build.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(): Response {
  // NEXT_PUBLIC_BUILD_SHA = explicit GIT_SHA override; NEXT_PUBLIC_BUILD_COMMIT =
  // Coolify's predefined SOURCE_COMMIT build arg (auto, no manual config). Either
  // is inlined at `next build`, so this reports the exact commit the live web
  // container was built from — the definitive stale-deploy check.
  const commit =
    process.env.NEXT_PUBLIC_BUILD_SHA ||
    process.env.NEXT_PUBLIC_BUILD_COMMIT ||
    "unknown";
  return Response.json(
    { commit, builtAt: process.env.NEXT_PUBLIC_BUILD_TIME || "unknown" },
    { headers: { "Cache-Control": "no-store, max-age=0" } },
  );
}
