import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

// Prisma's query engine (Rust/Tokio) sizes its connection pool as
// num_cpus * 2 + 1 by default when DATABASE_URL doesn't specify
// connection_limit. On this shared cyberfolks host, num_cpus reflects the
// physical machine's core count, not this account's CloudLinux LVE
// allocation — so the engine tries to open far more connections/threads
// than the account's process/thread limit allows the moment this client is
// first used, which is consistent with the account's 100-process LVE cap
// being exhausted within seconds of the very first request after startup
// (this is the same class of bug already confirmed for `next build`'s
// Rust/tokio panic on this same account). Force a small, fixed pool size
// regardless of what DATABASE_URL sets, since this app's own request
// concurrency never needs more than a handful of connections anyway.
// process.env.DATABASE_URL is empty during `next build` (only the Node
// runtime has it, via the server's .env / cPanel env config), so this must
// tolerate a missing/unparseable value rather than throwing at import time
// — throwing here would fail the build itself, not just runtime behavior.
function withConnectionLimit(url: string | undefined): string | undefined {
  if (!url) return url;
  try {
    const withLimit = new URL(url);
    if (!withLimit.searchParams.has("connection_limit")) {
      withLimit.searchParams.set("connection_limit", "5");
    }
    return withLimit.toString();
  } catch {
    return url;
  }
}

// The constructor itself eagerly validates datasources.db.url when passed —
// even `{ url: undefined }` throws — unlike the plain no-args form, which
// defers to schema.prisma's env("DATABASE_URL") lookup lazily. So only pass
// the override once there's an actual value to adjust.
const limitedUrl = withConnectionLimit(process.env.DATABASE_URL);
export const prisma =
  globalForPrisma.prisma ??
  (limitedUrl ? new PrismaClient({ datasources: { db: { url: limitedUrl } } }) : new PrismaClient());

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
