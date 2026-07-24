import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  basePath: "/wynajem",
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
