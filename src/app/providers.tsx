"use client";

import { SessionProvider } from "next-auth/react";

// next-auth/react derives its client-side API base path from NEXTAUTH_URL's
// pathname, which is intentionally the plain origin (no /wynajem) — so
// signIn()/getCsrfToken()/getSession() etc. would otherwise call bare
// /api/auth/* from the browser. Those requests never reach the Node app at
// all (Apache/Passenger only routes /wynajem/*), producing a 404 instead of
// a NextAuth response. Must match `basePath` in src/auth.ts.
export function Providers({ children }: { children: React.ReactNode }) {
  return <SessionProvider basePath="/wynajem/api/auth">{children}</SessionProvider>;
}
