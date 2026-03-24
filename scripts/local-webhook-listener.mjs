#!/usr/bin/env node
/**
 * Minimal local webhook sink for manual testing.
 * Listens on PORT (default 3001), logs requests, responds 200 JSON.
 *
 * Usage: node scripts/local-webhook-listener.mjs
 *    or: PORT=3001 node scripts/local-webhook-listener.mjs
 */

import http from "node:http";

const port = Number(process.env.PORT) || 3001;

const server = http.createServer((req, res) => {
  const chunks = [];

  req.on("data", (chunk) => chunks.push(chunk));
  req.on("end", () => {
    const body = Buffer.concat(chunks);
    const preview = body.length > 512 ? `${body.subarray(0, 512).toString("utf8")}…` : body.toString("utf8");

    console.log(`[${new Date().toISOString()}] ${req.method} ${req.url} (${body.length} bytes)`);
    if (preview) {
      console.log(preview);
    }

    res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
    res.end(
      JSON.stringify({
        ok: true,
        listener: "local-webhook-listener.mjs",
        method: req.method,
        path: req.url,
        receivedBytes: body.length,
      }),
    );
  });
});

server.listen(port, "127.0.0.1", () => {
  console.log(`Local webhook listener on http://127.0.0.1:${port}/ (any path)`);
  console.log("Set webhookrelay Local URL e.g. http://127.0.0.1:3001/api/webhook");
});
