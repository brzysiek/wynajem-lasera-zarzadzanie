// Custom server required by cPanel's Node.js Selector (Passenger).
// Passenger starts this file directly and expects the app to listen on
// the port it provides via process.env.PORT.
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

app.prepare().then(() => {
  const server = createServer((req, res) => {
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
  const shutdown = () => {
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 5000).unref();
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
});
