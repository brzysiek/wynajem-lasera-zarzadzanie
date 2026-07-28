"use client";

import { SessionProvider } from "next-auth/react";
import { BASE_PATH } from "@/lib/base-path";

// next-auth/react derives its client-side API base path from NEXTAUTH_URL's
// pathname, which is intentionally the plain origin (no basePath) — so
// signIn()/getCsrfToken()/getSession() etc. would otherwise call bare
// /api/auth/* from the browser. Those requests never reach the Node app at
// all (Apache/Passenger only routes under the basePath), producing a 404
// instead of a NextAuth response. Must match `basePath` in src/auth.ts.
export function Providers({ children }: { children: React.ReactNode }) {
  return <SessionProvider basePath={`${BASE_PATH}/api/auth`}>{children}</SessionProvider>;
}
