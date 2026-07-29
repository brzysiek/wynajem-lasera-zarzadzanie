// Custom server required by cPanel's Node.js Selector (Passenger).
// Passenger starts this file directly and expects the app to listen on
// the port it provides via process.env.PORT.
//
// NOTE: this account's actual serving stack turned out to be LiteSpeed's own
// "lsnode" Node.js integration (LSAPI), not Apache+Passenger, despite the
// PassengerXxx directive names in .htaccess (LiteSpeed reads them for cPanel
// compatibility). lsnode spawns this file's process directly and tracks that
// exact PID for its request hand-off (a unix socket, per LSNODE_SOCKET/fd 0 —
// there is no PORT env var in this environment at all). An earlier fix here
// had this file re-exec itself through a `bash -c 'ulimit ...; exec taskset
// ...'` wrapper via child_process.spawn() to fight a Prisma/Tokio
// thread-explosion (see prisma.ts) — but spawn() creates a NEW child PID, so
// the process lsnode actually forwards traffic to was no longer the one it
// had originally launched/tracked. Result: a perfectly stable, low-thread
// process that never received a single request. The ulimit/taskset fix is
// still needed, but now applied one layer up — via a wrapper script
// (deploy/node-wrapper.sh) substituted as PassengerNodejs in .htaccess, so
// the whole chain is true exec() (same PID throughout) and this file goes
// back to just listening directly, matching what lsnode expects.

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

// SMS reminders used to be triggered by this process itself (a loopback HTTP
// POST on a setInterval), but this host's Node process isn't guaranteed to
// stay alive between requests (LVE limit spikes, see the logDiag comments
// above, plus LiteSpeed lsnode appears to recycle idle processes) — the
// in-process timer would silently stop firing for long stretches whenever
// nobody happened to be browsing the site. Reminders are now triggered by
// two real cPanel Cron Jobs hitting the public domain on fixed schedules
// (which also has the side effect of waking the app up if it had gone
// idle): a frequent one hitting /api/cron/reminders that builds the
// send-queue, and a once-a-day one hitting /api/cron/reminders/send that
// actually sends what's queued. Both schedules live only in cPanel — see
// the "Przypomnienia SMS" settings page for how to change them.

app.prepare().then(() => {
  logDiag("startup");
  // Fires regardless of request traffic, so the thread ramp-up between the
  // process starting and the first request landing is also captured, not
  // just the request-triggered samples below. Opt-in via DIAG_LOG_INTERVAL=true
  // — this was added to chase a specific LVE thread-explosion incident and
  // left running by default afterwards would just grow diag.log forever for
  // no ongoing benefit.
  if (process.env.DIAG_LOG_INTERVAL === "true") {
    setInterval(() => logDiag("interval"), 2000).unref();
  }

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
