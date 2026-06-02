// Tech-stack detection catalog (patch-18). Deliberately NON-exhaustive at the
// start — it grows by observation (false positives/negatives logged in
// findings.md calibrate the regexes, new tools get added here). No third-party
// detection service (e.g. Wappalyzer API): every signature is a local pattern
// over headers / scripts / DOM / footer that we already capture for free.

export type TechCategory =
  | "frontend" // Next.js, React, Vue
  | "hosting" // Vercel, Netlify
  | "cdn" // Cloudflare, Fastly, AWS CloudFront
  | "analytics" // PostHog, Mixpanel, GA, Segment
  | "auth" // Auth0, Clerk
  | "payments" // Stripe, Paddle, Lemon Squeezy
  | "crm_integration" // Salesforce, HubSpot (presence in footer/scripts)
  | "communication" // Intercom, Crisp, Drift
  | "support" // Zendesk
  | "email" // Resend, Postmark, SendGrid
  | "monitoring" // Sentry, Datadog
  | "marketing"; // Mailchimp, HubSpot marketing

export type ImportanceLevel = "high" | "medium" | "low";

export interface HeaderMatcher {
  name: string; // lower-case header name
  value: RegExp; // tested against the header value (use /./ for "present")
}

export interface TechSignature {
  id: string; // "stripe", "salesforce", "vercel"
  name: string; // "Stripe", "Salesforce"
  category: TechCategory;
  importance: ImportanceLevel;
  detectors: {
    scriptUrls?: RegExp[]; // patterns tested against <script src> URLs
    headers?: HeaderMatcher[]; // response header name + value pattern
    domPatterns?: RegExp[]; // distinctive id/class/markup tested against raw HTML
    footerKeywords?: string[]; // case-insensitive substrings searched in the footer
  };
}

// importance rationale:
//  high   — a strategic/commercial tell (payments, CRM integrations) whose
//           appearance is worth a signal (e.g. a competitor wiring Salesforce).
//  medium — a meaningful infra/analytics choice (hosting, product analytics,
//           live-chat) — worth a signal by default (TECH_STACK_SIGNAL_MIN_IMPORTANCE).
//  low    — ubiquitous/low-signal infra (a CDN, a framework) — tracked for the
//           profile but never alerted on by default.
export const TECH_CATALOG: TechSignature[] = [
  {
    id: "stripe",
    name: "Stripe",
    category: "payments",
    importance: "high",
    detectors: {
      scriptUrls: [/js\.stripe\.com/, /checkout\.stripe\.com/],
      footerKeywords: ["powered by stripe"],
    },
  },
  {
    id: "paddle",
    name: "Paddle",
    category: "payments",
    importance: "high",
    detectors: {
      scriptUrls: [/cdn\.paddle\.com/, /buy\.paddle\.com/],
    },
  },
  {
    id: "lemonsqueezy",
    name: "Lemon Squeezy",
    category: "payments",
    importance: "high",
    detectors: {
      scriptUrls: [/lemonsqueezy\.com/, /lmsqueezy\.com/],
    },
  },
  {
    id: "salesforce",
    name: "Salesforce",
    category: "crm_integration",
    importance: "high",
    detectors: {
      scriptUrls: [/salesforce\.com/, /force\.com/, /pardot\.com/],
      footerKeywords: ["salesforce integration", "integrates with salesforce", "salesforce"],
    },
  },
  {
    id: "hubspot",
    name: "HubSpot",
    category: "crm_integration",
    importance: "high",
    detectors: {
      scriptUrls: [/js\.hs-scripts\.com/, /js\.hsforms\.net/, /hsforms\.com/, /hs-analytics\.net/],
      footerKeywords: ["hubspot"],
    },
  },
  {
    id: "intercom",
    name: "Intercom",
    category: "communication",
    importance: "medium",
    detectors: {
      scriptUrls: [/widget\.intercom\.io/, /intercomcdn\.com/, /js\.intercomcdn/],
      domPatterns: [/intercom-/],
    },
  },
  {
    id: "crisp",
    name: "Crisp",
    category: "communication",
    importance: "medium",
    detectors: {
      scriptUrls: [/client\.crisp\.chat/],
      domPatterns: [/crisp-client/],
    },
  },
  {
    id: "drift",
    name: "Drift",
    category: "communication",
    importance: "medium",
    detectors: {
      scriptUrls: [/js\.driftt\.com/, /drift\.com/],
    },
  },
  {
    id: "zendesk",
    name: "Zendesk",
    category: "support",
    importance: "medium",
    detectors: {
      scriptUrls: [/static\.zdassets\.com/, /zendesk\.com/, /zopim\.com/],
      domPatterns: [/zendesk|zopim/],
    },
  },
  {
    id: "posthog",
    name: "PostHog",
    category: "analytics",
    importance: "medium",
    detectors: {
      scriptUrls: [/posthog\.com/, /\/posthog\.js/, /\/array\.js/, /i\.posthog\.com/],
    },
  },
  {
    id: "segment",
    name: "Segment",
    category: "analytics",
    importance: "medium",
    detectors: {
      scriptUrls: [/cdn\.segment\.com/, /segment\.io/],
    },
  },
  {
    id: "mixpanel",
    name: "Mixpanel",
    category: "analytics",
    importance: "medium",
    detectors: {
      scriptUrls: [/cdn\.mxpnl\.com/, /mixpanel\.com/],
    },
  },
  {
    id: "amplitude",
    name: "Amplitude",
    category: "analytics",
    importance: "medium",
    detectors: {
      scriptUrls: [/cdn\.amplitude\.com/, /api\.amplitude\.com/, /amplitude\.com\/libs/],
    },
  },
  {
    id: "google-analytics",
    name: "Google Analytics",
    category: "analytics",
    importance: "low",
    detectors: {
      scriptUrls: [/googletagmanager\.com\/gtag/, /google-analytics\.com\/analytics\.js/],
    },
  },
  {
    id: "auth0",
    name: "Auth0",
    category: "auth",
    importance: "medium",
    detectors: {
      scriptUrls: [/cdn\.auth0\.com/, /\.auth0\.com/],
    },
  },
  {
    id: "clerk",
    name: "Clerk",
    category: "auth",
    importance: "medium",
    detectors: {
      scriptUrls: [/clerk\.[a-z.]*accounts\.dev/, /clerk\.com/, /\.clerk\.services/],
      domPatterns: [/cl-internal|__clerk/],
    },
  },
  {
    id: "sentry",
    name: "Sentry",
    category: "monitoring",
    importance: "low",
    detectors: {
      scriptUrls: [/browser\.sentry-cdn\.com/, /js\.sentry-cdn\.com/],
    },
  },
  {
    id: "mailchimp",
    name: "Mailchimp",
    category: "marketing",
    importance: "medium",
    detectors: {
      scriptUrls: [/chimpstatic\.com/, /list-manage\.com/, /mailchimp\.com/],
    },
  },
  {
    id: "vercel",
    name: "Vercel",
    category: "hosting",
    importance: "medium",
    detectors: {
      headers: [
        { name: "server", value: /vercel/i },
        { name: "x-vercel-id", value: /./ },
        { name: "x-vercel-cache", value: /./ },
      ],
    },
  },
  {
    id: "netlify",
    name: "Netlify",
    category: "hosting",
    importance: "medium",
    detectors: {
      headers: [
        { name: "server", value: /netlify/i },
        { name: "x-nf-request-id", value: /./ },
      ],
    },
  },
  {
    id: "cloudflare",
    name: "Cloudflare",
    category: "cdn",
    importance: "low",
    detectors: {
      headers: [
        { name: "server", value: /cloudflare/i },
        { name: "cf-ray", value: /./ },
      ],
    },
  },
  {
    id: "fastly",
    name: "Fastly",
    category: "cdn",
    importance: "low",
    detectors: {
      headers: [
        { name: "x-served-by", value: /cache-/i },
        { name: "x-fastly-request-id", value: /./ },
        { name: "fastly-io-info", value: /./ },
      ],
    },
  },
  {
    id: "aws-cloudfront",
    name: "AWS CloudFront",
    category: "cdn",
    importance: "low",
    detectors: {
      headers: [
        { name: "x-amz-cf-id", value: /./ },
        { name: "via", value: /cloudfront/i },
      ],
    },
  },
  {
    id: "next.js",
    name: "Next.js",
    category: "frontend",
    importance: "low",
    detectors: {
      headers: [{ name: "x-powered-by", value: /next\.js/i }],
      domPatterns: [/__NEXT_DATA__/, /\/_next\//],
    },
  },
];
