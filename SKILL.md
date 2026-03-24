# Webhookrelay Skill

Webhookrelay does one thing: it relays third-party webhooks to a local app over one outbound `wss` connection.

## When To Use It

- You need a public webhook URL for Stripe, GitHub, Shopify, Slack, or another webhook source.
- Your app is running on `localhost`.
- You want the shortest path from "I need a webhook URL" to "my local app received it."

## What It Is Not

- Not a reverse proxy.
- Not a tunnel for arbitrary ports.
- Not a generic ingress product.
- Not a place to park or replay webhook history forever.

## Data handling

- Payloads are relayed **in memory** only; the relay Durable Object does **not** persist webhook bodies (`RelaySession` has no `ctx.storage` for events).
- Only **aggregated popularity counts** by catalog app id are stored (`Popularity` DO).
- The Worker does **not** log webhook bodies; uncaught errors log `requestId` and a short error message only. Cloudflare account logging is separate from this app code.
- Session JSON includes **`wsTokenExpiresInHours`** (listener WebSocket token lifetime). The public **`/h/...` URL** stays valid until **`RELAY_SIGNING_KEY`** is rotated (hook IDs are HMAC-signed, not time-limited in code).

## Fast Path

1. Pick your source app on `webhookrelay.app`.
2. Copy the one-command local listener.
3. Set `LOCAL_URL` to your local webhook handler.
4. Paste it into your terminal.
5. Paste the generated public webhook URL into the third-party app.
6. Send a test event or run the provided `curl` command.

## Local Listener Contract

- The local listener opens one outbound `wss` connection.
- Each incoming webhook is forwarded to your `LOCAL_URL`.
- Your local app's status code is sent back to the webhook sender (real provider traffic).
- The modal's Terminal B `curl` smoke test sends `X-Webhookrelay-Smoke: 1`. For those requests only, the listener returns HTTP `200` with JSON that explains success, a local `404` (wrong route), or an unreachable port (nothing listening). Troubleshooting lines are in `nextSteps` (a string array) so each `lsof` command appears on its own line in the pretty-printed JSON—no literal `\n` inside a JSON string. Commands (macOS/Linux): `lsof -nP -iTCP:<port> -sTCP:LISTEN` and `lsof -nP -iTCP -sTCP:LISTEN`. The response body ends with a newline so the shell prompt does not run into the closing `}`.
- If no listener is connected, webhookrelay returns a clear `503` with the next step.

## Product Principles

- PLG first.
- Minimal LOC.
- KISS.
- Human-readable setup.
- No dead ends.
- OSS with an MIT license.
