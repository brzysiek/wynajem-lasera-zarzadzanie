// Custom server required by cPanel's Node.js Selector (Passenger).
// Passenger starts this file directly and expects the app to listen on
// the port it provides via process.env.PORT.
const { createServer } = require("http");
const next = require("next");

const port = parseInt(process.env.PORT || "3000", 10);
const dev = process.env.NODE_ENV !== "production";
const app = next({ dev });
const handle = app.getRequestHandler();

app.prepare().then(() => {
  const server = createServer((req, res) => {
    handle(req, res);
  }).listen(port, () => {
    console.log(`> Ready on port ${port} (${dev ? "development" : "production"})`);
  });

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
