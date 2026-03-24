#!/usr/bin/env node

const RESET = "\x1b[0m";
const DIM = "\x1b[2m";
const CYAN = "\x1b[36m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const RED = "\x1b[31m";

function tag(label, color) {
  return color + "[" + label + "]" + RESET;
}

function now() {
  return new Date().toLocaleTimeString();
}

function parseArgs(argv) {
  const result = {};

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (!arg.startsWith("--")) {
      continue;
    }

    const [rawKey, inlineValue] = arg.slice(2).split("=", 2);

    if (inlineValue !== undefined) {
      result[rawKey] = inlineValue;
      continue;
    }

    const next = argv[index + 1];

    if (!next || next.startsWith("--")) {
      result[rawKey] = true;
      continue;
    }

    result[rawKey] = next;
    index += 1;
  }

  return result;
}

function printUsage() {
  console.log(`webhookrelay CLI

Usage:
  RELAY_URL="wss://..." LOCAL_URL="http://localhost:3000/api/webhook" APP_NAME="Stripe" node webhookrelay.mjs

Options:
  --relay-url <url>   Relay websocket URL
  --local-url <url>   Local webhook handler URL
  --app-name <name>   Friendly app name
  --help              Show this help
`);
}

/** Copy-paste commands for macOS / Linux (lsof is built in on macOS). */
function listenCheckSteps(port) {
  return [
    `Only port ${port}: lsof -nP -iTCP:${port} -sTCP:LISTEN`,
    "Every TCP listener: lsof -nP -iTCP -sTCP:LISTEN",
  ];
}

function encodeSmokeBody(payload) {
  return Buffer.from(`${JSON.stringify(payload, null, 2)}\n`).toString("base64");
}

function headerLookup(headers, name) {
  if (!headers) {
    return null;
  }

  const lower = name.toLowerCase();

  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() === lower) {
      return headers[key];
    }
  }

  return null;
}

function stripSmokeHeaders(headers) {
  const next = { ...(headers || {}) };

  for (const key of Object.keys(next)) {
    if (key.toLowerCase() === "x-webhookrelay-smoke") {
      delete next[key];
    }
  }

  return next;
}

function localListenPort(localUrl) {
  const u = new URL(localUrl);

  return u.port || (u.protocol === "https:" ? "443" : "80");
}

const args = parseArgs(process.argv.slice(2));
const RELAY_URL = args["relay-url"] || process.env.RELAY_URL;
const LOCAL_URL = args["local-url"] || process.env.LOCAL_URL;
const APP_NAME = args["app-name"] || process.env.APP_NAME || "Webhook";
let activeSocket = null;
let shouldReconnect = true;

if (args.help || !RELAY_URL || !LOCAL_URL) {
  printUsage();
  process.exit(args.help ? 0 : 1);
}

function shutdown() {
  shouldReconnect = false;
  console.log(DIM + "Stopping webhookrelay listener..." + RESET);
  if (activeSocket && activeSocket.readyState === WebSocket.OPEN) {
    activeSocket.close(1000, "Stopped locally.");
  }
  setTimeout(() => process.exit(0), 50);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

function connect() {
  const ws = new WebSocket(RELAY_URL);
  activeSocket = ws;

  ws.onopen = () => {
    console.log(tag("listen", CYAN), now(), "webhookrelay listening for", APP_NAME, "->", LOCAL_URL);
  };

  ws.onmessage = async ({ data }) => {
    let msg;

    try {
      msg = JSON.parse(data);
    } catch {
      return;
    }

    if (msg.type !== "webhook") {
      return;
    }

    const startedAt = Date.now();
    console.log(tag("hit", YELLOW), now(), msg.method, msg.appName || APP_NAME, msg.search || "");

    const url = new URL(LOCAL_URL);

    for (const [key, value] of new URLSearchParams(msg.search)) {
      url.searchParams.append(key, value);
    }

    const isSmoke = headerLookup(msg.headers, "x-webhookrelay-smoke") === "1";
    const forwardHeaders = stripSmokeHeaders(msg.headers);
    const listenPort = localListenPort(LOCAL_URL);
    const localPath = new URL(LOCAL_URL).pathname;

    try {
      const response = await fetch(url, {
        method: msg.method,
        headers: forwardHeaders,
        body: msg.body ? Buffer.from(msg.body, "base64") : undefined,
      });

      const body = Buffer.from(await response.arrayBuffer());
      const safeBody = body.length > 65536 ? body.subarray(0, 65536) : body;

      if (isSmoke) {
        let smokePayload;

        if (response.ok) {
          smokePayload = {
            ok: true,
            smokeTest: true,
            code: "local_ok",
            port: listenPort,
            summary: `Success, your localhost application received the message on port ${listenPort}.`,
            localStatus: response.status,
          };
        } else if (response.status === 404) {
          smokePayload = {
            ok: false,
            smokeTest: true,
            code: "local_not_found",
            port: listenPort,
            path: localPath,
            summary:
              `Webhookrelay received your smoke test and reached your machine on port ${listenPort}, but your app responded with HTTP 404 (no handler for this path).`,
            nextSteps: [...listenCheckSteps(listenPort), "Then fix your Local URL or add a matching route."],
          };
        } else {
          smokePayload = {
            ok: false,
            smokeTest: true,
            code: "local_error",
            port: listenPort,
            localStatus: response.status,
            summary: `Webhookrelay reached port ${listenPort}, but your app returned HTTP ${response.status}.`,
            nextSteps: listenCheckSteps(listenPort),
          };
        }

        ws.send(JSON.stringify({
          type: "response",
          id: msg.id,
          status: 200,
          headers: {
            "content-type": "application/json; charset=utf-8",
          },
          body: encodeSmokeBody(smokePayload),
        }));

        console.log(
          tag("done", GREEN),
          now(),
          "smoke",
          response.status,
          "->",
          200,
          msg.method,
          "in",
          `${Date.now() - startedAt}ms`,
        );
      } else {
        ws.send(JSON.stringify({
          type: "response",
          id: msg.id,
          status: response.status,
          headers: {
            "content-type": response.headers.get("content-type") || "text/plain; charset=utf-8",
          },
          body: safeBody.toString("base64"),
        }));

        console.log(tag("done", GREEN), now(), response.status, msg.method, "in", `${Date.now() - startedAt}ms`);
      }
    } catch (error) {
      if (isSmoke) {
        const smokePayload = {
          ok: false,
          smokeTest: true,
          code: "local_unreachable",
          port: listenPort,
          summary:
            `Webhookrelay received your smoke test, but nothing accepted the connection on port ${listenPort} (your app may be stopped or on a different port).`,
          nextSteps: listenCheckSteps(listenPort),
          detail: String(error),
        };

        ws.send(JSON.stringify({
          type: "response",
          id: msg.id,
          status: 200,
          headers: {
            "content-type": "application/json; charset=utf-8",
          },
          body: encodeSmokeBody(smokePayload),
        }));
      } else {
        ws.send(JSON.stringify({
          type: "response",
          id: msg.id,
          status: 502,
          headers: {
            "content-type": "application/json; charset=utf-8",
          },
          body: Buffer.from(JSON.stringify({
            ok: false,
            error: {
              code: "local_fetch_failed",
              message: String(error),
              nextStep: "Make sure LOCAL_URL is running, then send the webhook again.",
            },
          })).toString("base64"),
        }));
      }

      console.error(tag("error", RED), now(), "local fetch failed", String(error));
    }
  };

  ws.onclose = () => {
    if (activeSocket === ws) {
      activeSocket = null;
    }

    if (!shouldReconnect) {
      return;
    }

    console.log(DIM + "webhookrelay disconnected. Reconnecting in 1s..." + RESET);
    setTimeout(connect, 1000);
  };

  ws.onerror = () => {
    console.error(tag("error", RED), now(), "webhookrelay socket error");
  };
}

connect();
