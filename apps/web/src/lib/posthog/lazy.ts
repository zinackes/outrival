"use client";

import type { PostHog } from "posthog-js";
import { getConsent } from "../consent";

// PostHog, loaded after the page is interactive rather than inside it, and only for
// a visitor whose consent allows it to send anything.
//
// Every module that reached for the SDK imported `posthog-js` statically, and one of
// them (the provider) sits in the ROOT layout. So the analytics SDK landed in the
// first-load JS of every page in the product, marketing pages included, and the
// browser had to fetch, parse and execute it before it could paint. Nothing about
// analytics needs to happen before the first paint: an event that fires 500ms late is
// worth exactly what one that fires on time is worth.
//
// The `import type` above is erased at build time, so this module pulls no runtime
// code by itself. The real import happens on the first of two triggers: the idle
// callback the provider schedules, or the first event someone tries to send.
//
// Consent is not just preserved, it is now load-bearing. The SDK still initialises
// opted OUT and only opts in when the cookie says granted, exactly as before. What
// changed is that a visitor who REFUSED never downloads it at all: with capturing
// off, fetching 60KB of analytics code accomplishes nothing but a slower page.

let instance: PostHog | null = null;
let loading: Promise<PostHog | null> | null = null;

// Pageviews that happened before the SDK finished loading. Dropping them would
// quietly break the acquisition funnel: the landing view is the FIRST event of every
// session, and it always precedes both the idle load and the consent click. Held in
// memory only, so nothing leaves the browser before consent exists.
const pendingViews: string[] = [];

function apiKey(): string | null {
  const key = process.env.NEXT_PUBLIC_POSTHOG_KEY;
  if (!key || key.includes("REPLACE_ME")) return null;
  return key;
}

/** Would anything this SDK sends actually be allowed to leave? */
function mayCapture(): boolean {
  return getConsent() === "granted";
}

/** The loaded SDK, or null. Never triggers a load. */
export function posthogIfLoaded(): PostHog | null {
  return instance;
}

/**
 * Load and initialise the SDK, once. Resolves to null when analytics is not
 * configured, when called on the server, or when the chunk fails to load (an
 * ad-blocker, a flaky network): a missing analytics SDK must never surface to the
 * user, so every caller treats null as "skip".
 */
function loadPosthog(): Promise<PostHog | null> {
  if (instance) return Promise.resolve(instance);
  if (loading) return loading;
  const key = apiKey();
  if (!key || typeof window === "undefined") return Promise.resolve(null);

  loading = import("posthog-js")
    .then(({ default: posthog }) => {
      posthog.init(key, {
        // Same-origin reverse proxy (see rewrites in next.config.ts) so ad-blockers
        // can't blacklist the ingest host. Path is a non-obvious slug ("/relay", not
        // "/ingest"): EasyPrivacy/uBlock block by PATH pattern too, and "/ingest" is
        // itself blacklisted, so it stayed blocked. ui_host keeps "Open in PostHog"
        // links pointing at the real EU app.
        api_host: "/relay",
        ui_host: "https://eu.posthog.com",
        person_profiles: "identified_only",
        capture_pageview: false,
        autocapture: true,
        opt_out_capturing_by_default: true,
        session_recording: {
          maskAllInputs: true,
          maskTextSelector: "[data-ph-mask]",
        },
      });
      if (mayCapture()) posthog.opt_in_capturing();
      instance = posthog;
      flushPendingViews(posthog);
      return posthog;
    })
    .catch(() => null);
  return loading;
}

function flushPendingViews(p: PostHog): void {
  const views = pendingViews.splice(0, pendingViews.length);
  if (!p.has_opted_in_capturing()) return;
  for (const url of views) p.capture("$pageview", { $current_url: url });
}

/**
 * Run something against the SDK, loading it first if needed. Fire and forget:
 * analytics never blocks a caller and never throws into one. A no-op when consent
 * does not allow capturing, which is what keeps the chunk off a refusing visitor's
 * network tab.
 */
export function withPosthog(cb: (p: PostHog) => void): void {
  if (!mayCapture()) return;
  void loadPosthog().then((p) => {
    if (p) cb(p);
  });
}

/** Capture a pageview, holding it if the SDK has not loaded yet. */
export function recordPageview(url: string): void {
  const p = instance;
  if (p) {
    if (p.has_opted_in_capturing()) p.capture("$pageview", { $current_url: url });
    return;
  }
  // "unset" is the first-visit case: the banner is still on screen, so this view is
  // held rather than lost, and it is sent only if the visitor then grants consent.
  // An explicit refusal drops it on the floor.
  if (apiKey() && getConsent() !== "denied") pendingViews.push(url);
}

/**
 * Apply a consent decision. Granting loads the SDK on demand (this is the one moment
 * where waiting for idle would be wrong); refusing only has to reach a client that
 * is already running, and must never cause one to load.
 */
export function applyConsent(granted: boolean): void {
  if (granted) {
    withPosthog((p) => p.opt_in_capturing());
    return;
  }
  posthogIfLoaded()?.opt_out_capturing();
  pendingViews.length = 0;
}

/**
 * Schedule the load for when the browser is done with the work that matters.
 * `requestIdleCallback` is missing in Safari, hence the timeout fallback; both are
 * bounded so the SDK always arrives, just never first.
 */
export function schedulePosthogLoad(): () => void {
  if (typeof window === "undefined" || !apiKey() || !mayCapture()) return () => {};
  const idle = (
    window as Window & {
      requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
    }
  ).requestIdleCallback;
  if (idle) {
    const handle = idle(() => void loadPosthog(), { timeout: 3000 });
    return () => {
      (window as Window & { cancelIdleCallback?: (h: number) => void }).cancelIdleCallback?.(
        handle,
      );
    };
  }
  const timer = window.setTimeout(() => void loadPosthog(), 2000);
  return () => window.clearTimeout(timer);
}
