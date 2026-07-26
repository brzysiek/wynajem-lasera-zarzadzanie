import { PrismaClient } from "@prisma/client";
import { PrismaMariaDb } from "@prisma/adapter-mariadb";

// @prisma/adapter-mariadb bundles its own nested copy of the `mariadb`
// package (a different version than the one in our own node_modules), so
// importing `PoolConfig` from the top-level `mariadb` package produces two
// structurally similar but nominally distinct types that don't assign to
// each other. A minimal local shape sidesteps that entirely — every field
// below is a standard, stable option name across mariadb driver versions.
type MariaPoolConfig = {
  host: string;
  port: number | undefined;
  user: string;
  password: string;
  database: string;
  connectionLimit: number;
};

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

// Prisma's default query engine is a native Rust/Tokio binary loaded into
// this process. Its async worker-thread pool sizes off the host's detected
// CPU count (64 on this shared cyberfolks host, not this account's actual
// CloudLinux LVE allocation), and separately, its per-query blocking-task
// thread pool grows on demand with no ceiling tied to CPU count at all —
// together these exhausted the account's ~100 process/thread LVE cap within
// seconds of real traffic, even after CPU-affinity pinning (taskset, see
// server.js) fixed the startup thread count alone.
//
// Driver adapters remove the native engine from the process entirely:
// queries run through this plain JS `mariadb` driver over Node's own
// fixed-size libuv threadpool instead of Tokio, eliminating the thread
// growth at its source rather than capping it from outside.
//
// process.env.DATABASE_URL is empty during `next build` (only the Node
// runtime has it, via cPanel's env config), so parsing must tolerate a
// missing/unparseable value rather than throwing at import time.
function parsePoolConfig(url: string | undefined): MariaPoolConfig | undefined {
  if (!url) return undefined;
  try {
    const parsed = new URL(url);
    return {
      host: parsed.hostname,
      port: parsed.port ? parseInt(parsed.port, 10) : undefined,
      user: decodeURIComponent(parsed.username),
      password: decodeURIComponent(parsed.password),
      database: parsed.pathname.replace(/^\//, ""),
      // This app's own request concurrency never needs more than a handful
      // of connections, regardless of what's reachable on the host.
      connectionLimit: 5,
    };
  } catch {
    return undefined;
  }
}

function createPrismaClient(): PrismaClient {
  const poolConfig = parsePoolConfig(process.env.DATABASE_URL);
  if (!poolConfig) return new PrismaClient();
  return new PrismaClient({ adapter: new PrismaMariaDb(poolConfig) });
}

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
