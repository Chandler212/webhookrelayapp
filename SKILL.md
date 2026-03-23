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

## Fast Path

1. Pick your source app on `webhookrelay.app`.
2. Copy the tiny local listener script.
3. Set `LOCAL_URL` to your local webhook handler.
4. Run the script on your Mac.
5. Paste the generated public webhook URL into the third-party app.
6. Send a test event or run the provided `curl` command.

## Local Listener Contract

- The local listener opens one outbound `wss` connection.
- Each incoming webhook is forwarded to your `LOCAL_URL`.
- Your local app's status code is sent back to the webhook sender.
- If no listener is connected, webhookrelay returns a clear `503` with the next step.

## Product Principles

- PLG first.
- Minimal LOC.
- KISS.
- Human-readable setup.
- No dead ends.
- OSS with an MIT license.
