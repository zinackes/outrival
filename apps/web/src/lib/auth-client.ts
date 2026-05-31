import { createAuthClient } from "better-auth/react";

// Explicit return type avoids TS2742 "inferred type cannot be named" from
// better-auth's deeply-nested generics.
export const authClient: ReturnType<typeof createAuthClient> = createAuthClient(
  {
    baseURL: process.env.NEXT_PUBLIC_API_URL!,
  },
);

type AuthClient = typeof authClient;
export const useSession: AuthClient["useSession"] = authClient.useSession;
export const signIn: AuthClient["signIn"] = authClient.signIn;
export const signOut: AuthClient["signOut"] = authClient.signOut;
export const signUp: AuthClient["signUp"] = authClient.signUp;
