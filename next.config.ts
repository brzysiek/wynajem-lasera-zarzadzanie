import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Baked into the build at compile time — Next.js can't switch basePath at
  // runtime, so serving this app under a different URL prefix on another
  // server requires a separate build (see src/lib/base-path.ts). Defaults
  // to /wynajem to match the historical single-server setup when this env
  // var isn't explicitly set (e.g. local dev).
  basePath: process.env.NEXT_PUBLIC_BASE_PATH ?? "/wynajem",
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
