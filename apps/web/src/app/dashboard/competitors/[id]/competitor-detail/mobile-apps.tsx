/**
 * Mobile-app presence. Detected without AI from captures we already take (store
 * badges on the homepage, the .well-known app-association files) and stored on the
 * competitor's metadata by the worker. It is a FACT, not a signal: it never alerts,
 * it just answers "do they have an app?" so nobody has to go and search the stores.
 */
export interface MobileApps {
  ios: { appId: string; country: string; url: string } | null;
  android: { packageName: string; url: string } | null;
}

/** Pull the detector's output out of the competitor's free-form metadata. */
export function readMobileApps(
  metadata: Record<string, unknown> | null | undefined,
): MobileApps | null {
  const raw = metadata?.mobileApps as MobileApps | undefined;
  if (!raw || typeof raw !== "object") return null;
  const ios = raw.ios?.url ? raw.ios : null;
  const android = raw.android?.url ? raw.android : null;
  return ios || android ? { ios, android } : null;
}

function StoreLink({ href, label }: { href: string; label: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer noopener"
      className="inline-flex items-center rounded-sm border border-border px-2 py-1 text-xs text-muted-foreground transition-colors hover:border-border-strong hover:text-foreground"
    >
      {label}
    </a>
  );
}

/**
 * One sentence plus the store links. Rendered on both Overview and Positioning:
 * the fact belongs to the fact sheet, and shipping an app is a positioning move.
 */
export function MobileAppsFact({ apps, name }: { apps: MobileApps; name: string }) {
  const platforms =
    apps.ios && apps.android ? "iOS and Android" : apps.ios ? "iOS" : "Android";
  return (
    <div className="flex flex-col gap-2.5">
      <p className="max-w-[70ch] text-sm leading-relaxed text-muted-foreground">
        {name} ships a mobile app on {platforms}.
      </p>
      <div className="flex flex-wrap gap-1.5">
        {apps.ios && <StoreLink href={apps.ios.url} label="App Store" />}
        {apps.android && <StoreLink href={apps.android.url} label="Google Play" />}
      </div>
    </div>
  );
}
