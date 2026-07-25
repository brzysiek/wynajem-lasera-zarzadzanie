// Custom server required by cPanel's Node.js Selector (Passenger).
// Passenger starts this file directly and expects the app to listen on
// the port it provides via process.env.PORT.

// Root cause, confirmed via diag.log + server-side checks: this shared host
// reports 64 CPUs (`nproc`), and Prisma's query engine (Rust/Tokio) sizes its
// async runtime's worker threads off the detected CPU count, not this
// account's actual CloudLinux LVE allocation — diag.log showed 40 threads
// already present at bare startup, before a single real request, on an
// account whose entire "Entry Processes" limit is 100 (counts threads, not
// just forked processes). That alone was enough to make Prisma-driven thread
// creation eat roughly half the account's total process/thread budget on
// every cold start, and once it wins the race against Passenger's spawn
// timeout or LVE's cap, the process dies natively (no JS-level exception —
// crash.log stays empty) and Passenger respawns it, repeatedly, right into
// the same ceiling.
//
// Passenger execs this file directly with no shell in between, so neither
// `ulimit` nor `taskset` can just be prepended to the launch command —
// instead, re-exec once through bash to apply both:
//   - CPU affinity restricted to 2 cores, so num_cpus-based sizing (Rust's
//     num_cpus crate reads sched_getaffinity() on Linux, not raw core count)
//     sees 2 instead of 64 and Tokio's worker pool shrinks proportionally —
//     this is the actual fix, attacking the thread count at its source
//     rather than just capping the blast radius.
//   - A self-imposed RLIMIT_NPROC (rlimits set by a shell survive exec into
//     the replacing process, and RLIMIT_NPROC is enforced per-uid across the
//     whole account) as a backstop in case the affinity fix doesn't fully
//     eliminate the spike — set high enough (70) that hitting it doesn't
//     itself trigger a native abort the way an over-tight 50 did, while
//     still leaving headroom below LVE's hard 100 for SSH and diagnosis.
// Both are configurable via env vars so they can be tuned from cPanel
// without a redeploy.
if (!process.env.WYNAJEM_RLIMIT_APPLIED) {
  const { spawn } = require("child_process");
  const maxNproc = process.env.WYNAJEM_MAX_NPROC || "70";
  const cpuList = process.env.WYNAJEM_CPU_AFFINITY || "0,1";
  const child = spawn(
    "/bin/bash",
    [
      "-c",
      'ulimit -u "$0" 2>/dev/null; exec taskset -c "$1" "$2" "$3"',
      maxNproc,
      cpuList,
      process.execPath,
      __filename,
    ],
    { stdio: "inherit", env: { ...process.env, WYNAJEM_RLIMIT_APPLIED: "1" } },
  );
  process.on("SIGTERM", () => child.kill("SIGTERM"));
  process.on("SIGINT", () => child.kill("SIGINT"));
  child.on("exit", (code, signal) => {
    if (signal) process.kill(process.pid, signal);
    else process.exit(code === null ? 1 : code);
  });
  return;
}

const { createServer } = require("http");
const fs = require("fs");
const path = require("path");
const next = require("next");

const port = parseInt(process.env.PORT || "3000", 10);
const dev = process.env.NODE_ENV !== "production";
const app = next({ dev });
const handle = app.getRequestHandler();

// cPanel's log locations for Passenger apps aren't discoverable from the
// account, so write crashes here directly — this is the one place we're
// guaranteed to be able to find them (via File Manager or SSH).
const CRASH_LOG = path.join(__dirname, "crash.log");
function logCrash(label, err) {
  const line = `[${new Date().toISOString()}] ${label}: ${err && err.stack ? err.stack : err}\n`;
  try {
    fs.appendFileSync(CRASH_LOG, line);
  } catch {
    // Best-effort only — don't let logging itself take down the process.
  }
  console.error(line);
}

// crash.log stays empty during the LVE process-limit spikes, which rules out
// JS-level throws/rejections as the cause — but ps aux on the server also
// shows nothing during a spike, and SSH itself starts failing to fork at the
// same time, so there's no way to inspect the process live from outside it.
// Log from inside the process instead: thread count (CloudLinux LVE's
// nproc-style limit counts OS threads, not just distinct process names, so a
// single Node process whose native addons — e.g. Prisma's Tokio runtime —
// spawn many threads would show as one line in `ps aux` while still being
// the thing exhausting the account's limit) plus Node's own handle/request
// counts, on every request. This survives even if the process gets killed
// right after, unlike a live ps aux snapshot.
const DIAG_LOG = path.join(__dirname, "diag.log");
function readThreadCount() {
  try {
    const status = fs.readFileSync("/proc/self/status", "utf8");
    const match = status.match(/^Threads:\s*(\d+)/m);
    return match ? match[1] : "unknown";
  } catch {
    return "unavailable";
  }
}
function readNprocLimit() {
  try {
    const limits = fs.readFileSync("/proc/self/limits", "utf8");
    const match = limits.match(/Max processes\s+(\S+)\s+(\S+)/);
    return match ? `${match[1]}/${match[2]}` : "unknown";
  } catch {
    return "unavailable";
  }
}
function logDiag(label) {
  const line = `[${new Date().toISOString()}] pid=${process.pid} threads=${readThreadCount()} nproc_limit=${readNprocLimit()} handles=${process._getActiveHandles().length} requests=${process._getActiveRequests().length} ${label}\n`;
  try {
    fs.appendFileSync(DIAG_LOG, line);
  } catch {
    // Best-effort only.
  }
}

app.prepare().then(() => {
  logDiag("startup");
  // Fires regardless of request traffic, so the thread ramp-up between the
  // process starting and the first request landing is also captured, not
  // just the request-triggered samples below.
  setInterval(() => logDiag("interval"), 2000).unref();

  const server = createServer((req, res) => {
    logDiag(`request ${req.method} ${req.url}`);
    // A synchronous throw here would otherwise be an uncaught exception on
    // the http.Server 'request' event, killing the entire process (and
    // every other in-flight request with it) instead of just failing this
    // one request. Under Passenger, that death-on-every-request pattern is
    // exactly what drives the respawn loop that exhausts the account's LVE
    // process limit within seconds of a single page load.
    try {
      handle(req, res).catch((err) => {
        logCrash("request handler rejection", err);
        if (!res.headersSent) {
          res.statusCode = 500;
          res.end("Internal Server Error");
        }
      });
    } catch (err) {
      logCrash("request handler throw", err);
      if (!res.headersSent) {
        res.statusCode = 500;
        res.end("Internal Server Error");
      }
    }
  }).listen(port, () => {
    console.log(`> Ready on port ${port} (${dev ? "development" : "production"})`);
  });

  // Node's own guidance is not to keep running after uncaughtException (the
  // process may be in a corrupted state) — log it and exit so Passenger
  // restarts us cleanly, same as a normal crash. unhandledRejection is
  // logged but non-fatal: Node 15+ would otherwise terminate the process
  // for these too, which is unnecessarily aggressive for a long-running
  // server and was likely amplifying the respawn loop.
  process.on("uncaughtException", (err) => {
    logCrash("uncaughtException", err);
    process.exit(1);
  });
  process.on("unhandledRejection", (err) => logCrash("unhandledRejection", err));

  // Passenger restarts this app by sending SIGTERM (triggered by touching
  // tmp/restart.txt in deploy-finish.sh) and expects the process to exit on
  // its own. Without an explicit close, in-flight keep-alive connections can
  // keep the old process alive past Passenger's cleanup, leaving it as an
  // orphaned process that counts against the account's LVE process limit —
  // which compounds over many redeploys.
  const shutdown = (signal) => {
    logDiag(`shutdown ${signal}`);
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 5000).unref();
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
});
