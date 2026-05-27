"use client";

import { useEffect } from "react";
import { identifyUser } from "./events";

export function PostHogIdentitySync({
  userId,
  plan,
}: {
  userId: string;
  plan?: string;
}) {
  useEffect(() => {
    identifyUser(userId, plan ? { plan } : undefined);
  }, [userId, plan]);
  return null;
}
