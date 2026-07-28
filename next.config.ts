import type { NextConfig } from "next";

// Baked into the build at compile time — Next.js can't switch basePath at
// runtime, so serving this app under a different URL prefix on another
// server requires a separate build (see src/lib/base-path.ts). Defaults
// to /wynajem to match the historical single-server setup when this env
// var isn't explicitly set (e.g. local dev).
const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "/wynajem";

const nextConfig: NextConfig = {
  // Omit the key entirely for root-level serving instead of passing "" —
  // under this app's custom server (server.js's next({dev}) +
  // getRequestHandler(), not the `next start` CLI), an explicit empty-string
  // basePath made prerendered static routes (e.g. /login) 404 even though ""
  // is otherwise documented as the same as no basePath. Confirmed via a
  // local build+serve comparison: basePath: "" 404s on /login, no basePath
  // key at all serves it fine.
  ...(basePath ? { basePath } : {}),
  // Next sizes its build worker pool from the host's os.cpus() count, which
  // on shared cPanel hosting reflects the physical server, not this
  // account's much smaller process/thread quota (CloudLinux LVE limits) —
  // spawning that many workers fails with "OS can't spawn worker thread:
  // Resource temporarily unavailable". Cap it low.
  experimental: {
    cpus: 1,
  },
};

export default nextConfig;
