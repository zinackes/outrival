"use client";

import { openCookiePreferences } from "@/lib/consent";

/** Re-opens the cookie preferences panel. Used inline in the Cookie Policy and
 * in the footer so consent can be withdrawn as easily as it was given. */
export function CookiePreferencesButton({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <button type="button" onClick={openCookiePreferences} className={className}>
      {children}
    </button>
  );
}
