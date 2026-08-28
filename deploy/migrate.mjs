#!/usr/bin/env node
// Applies pending Prisma migrations WITHOUT `prisma migrate deploy`.
//
// `prisma migrate` spawns the Rust schema engine, which hangs on this
// account's CloudLinux LVE process/thread limits — the same reason
// `next build` runs in CI and the app uses the `mariadb` driver adapter
// instead of Prisma's native query engine (see src/lib/prisma.ts).
//
// This runner connects with the same plain-JS `mariadb` driver, executes
// each prisma/migrations/<name>/migration.sql that isn't recorded yet, and
// records it in `_prisma_migrations` using Prisma's own table format and
// checksum, so `prisma migrate status` / `prisma migrate diff` stay usable
// for authoring new migrations locally.
//
// Run from the app root (deploy/deploy-finish.sh does `cd "$APP_DIR"` first).

import { createHash, randomUUID } from "node:crypto";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import mariadb from "mariadb";

const MIGRATIONS_DIR = "prisma/migrations";
// Any migration whose folder name sorts <= this is assumed already present
// in a database that predates this runner (its schema was created from the
// old hand-written sql/schema.sql). Such migrations are recorded as applied
// on first run WITHOUT executing them. Everything after it runs normally.
// A brand-new/empty database has no such tables, so nothing is baselined
// and every migration (including this one) runs.
const BASELINE_THROUGH = "0_init";

function readDatabaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  // deploy-finish.sh doesn't export .env; Prisma CLI auto-loads it, we don't.
  if (existsSync(".env")) {
    const match = readFileSync(".env", "utf8").match(/^\s*DATABASE_URL\s*=\s*(.*)\s*$/m);
    if (match) return match[1].trim().replace(/^["']|["']$/g, "");
  }
  throw new Error("DATABASE_URL not found in environment or .env");
}

function parseConnectionConfig(url) {
  const u = new URL(url);
  return {
    host: u.hostname,
    port: u.port ? parseInt(u.port, 10) : 3306,
    user: decodeURIComponent(u.username),
    password: decodeURIComponent(u.password),
    database: u.pathname.replace(/^\//, ""),
    multipleStatements: true, // a migration.sql is several statements
    connectionLimit: 1,
  };
}

function listMigrations() {
  return readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .filter((name) => existsSync(join(MIGRATIONS_DIR, name, "migration.sql")))
    .sort(); // lexicographic — matches Prisma's apply order
}

function checksum(name) {
  const sql = readFileSync(join(MIGRATIONS_DIR, name, "migration.sql"));
  return createHash("sha256").update(sql).digest("hex");
}

async function ensureMigrationsTable(conn) {
  // Prisma's own _prisma_migrations schema (stable since Prisma 2).
  await conn.query(
    "CREATE TABLE IF NOT EXISTS `_prisma_migrations` (" +
      "`id` VARCHAR(36) NOT NULL," +
      "`checksum` VARCHAR(64) NOT NULL," +
      "`finished_at` DATETIME(3) NULL," +
      "`migration_name` VARCHAR(255) NOT NULL," +
      "`logs` TEXT NULL," +
      "`rolled_back_at` DATETIME(3) NULL," +
      "`started_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)," +
      "`applied_steps_count` INTEGER UNSIGNED NOT NULL DEFAULT 0," +
      "PRIMARY KEY (`id`)" +
      ") DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;",
  );
}

async function recordApplied(conn, name) {
  await conn.query(
    "INSERT INTO `_prisma_migrations` " +
      "(`id`, `checksum`, `finished_at`, `migration_name`, `started_at`, `applied_steps_count`) " +
      "VALUES (?, ?, NOW(3), ?, NOW(3), 1)",
    [randomUUID(), checksum(name), name],
  );
}

async function main() {
  const config = parseConnectionConfig(readDatabaseUrl());
  console.log(`==> migrate.mjs: ${config.database} @ ${config.host}:${config.port}`);
  const conn = await mariadb.createConnection(config);
  try {
    await ensureMigrationsTable(conn);

    // Clean up any half-written rows from a crashed/killed `prisma migrate
    // deploy` (e.g. the Rust engine hanging and the job timing out) so they
    // don't block or duplicate a real apply below.
    const orphaned = await conn.query(
      "DELETE FROM `_prisma_migrations` WHERE `finished_at` IS NULL AND `rolled_back_at` IS NULL",
    );
    if (orphaned.affectedRows > 0) {
      console.log(`    cleared ${orphaned.affectedRows} unfinished migration row(s)`);
    }

    const appliedRows = await conn.query(
      "SELECT `migration_name` FROM `_prisma_migrations` WHERE `finished_at` IS NOT NULL",
    );
    const applied = new Set(appliedRows.map((r) => r.migration_name));
    const all = listMigrations();

    // Baseline a pre-existing database on first run.
    if (applied.size === 0) {
      const existing = await conn.query("SHOW TABLES LIKE 'users'");
      if (existing.length > 0) {
        for (const name of all) {
          if (name <= BASELINE_THROUGH) {
            await recordApplied(conn, name);
            applied.add(name);
            console.log(`    baseline: marked ${name} as already applied (not executed)`);
          }
        }
      }
    }

    const pending = all.filter((name) => !applied.has(name));
    if (pending.length === 0) {
      console.log("==> migrate.mjs: no pending migrations");
      return;
    }

    for (const name of pending) {
      const sql = readFileSync(join(MIGRATIONS_DIR, name, "migration.sql"), "utf8");
      console.log(`==> applying ${name}`);
      await conn.query(sql);
      await recordApplied(conn, name);
      console.log(`    done ${name}`);
    }
    console.log(`==> migrate.mjs: applied ${pending.length} migration(s)`);
  } finally {
    await conn.end();
  }
}

main().catch((err) => {
  console.error("==> migrate.mjs FAILED:", err.message || err);
  process.exit(1);
});
