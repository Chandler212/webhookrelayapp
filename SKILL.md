# Webhookrelay Skill

Webhookrelay does one thing: it relays third-party webhooks to a local app over one outbound `wss` connection.

## When To Use It

- You need a public webhook URL for Stripe, GitHub, Shopify, Slack, or another webhook source.
- Your app is running on `localhost`.
- You want the shortest path from "I need a webhook URL" to "my local app received it."

## What It Is Not

- Not Ngrok or Cloudflare Tunnel—those are general-purpose tunnels. webhookrelay does one thing only: forward webhooks to localhost.
- Not a reverse proxy.
- Not a tunnel for arbitrary ports.
- Not a generic ingress product.
- Not a place to park or replay webhook history forever.

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
- If no listener is connected, webhookrelay returns a clear `503` with the next step.

## Product Principles

- No account required. Open source (MIT).
- Minimal footprint—no npm packages in the listener.
- Human-readable setup.
- No dead ends.
