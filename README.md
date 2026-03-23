# webhookrelay.app

Relay third-party webhooks to a local app over one outbound `wss` connection.

No tunnel. No reverse proxy. No generic ingress layer. Just a public webhook URL that forwards into `localhost`.

## What It Does

1. The homepage shows a large app grid sorted by rolling 7 day popularity.
2. Clicking an app creates a fresh relay session.
3. The modal gives you:
   - a public webhook URL
   - a tiny Node 22+ listener script with no npm packages
   - a `curl` smoke test
4. The listener opens one outbound websocket to `webhookrelay.app`.
5. Incoming webhooks are forwarded to your local URL and your local app's status code is sent back upstream.

## Local Listener

The generated listener is intentionally simple:

- Node 22+ only
- no npm install
- one file
- one `LOCAL_URL`
- automatic reconnect

## Routes

- `GET /` serves the app grid
- `GET /skill.md` serves the public skill file
- `GET /health` returns a small health payload
- `GET /api/apps` returns the sorted app catalog
- `POST /api/sessions` creates a fresh relay session
- `GET /ws/:hookId` accepts the local websocket listener
- `POST /h/:hookId` receives and forwards the third-party webhook

## Architecture

- One Cloudflare Worker for the site and API
- One `RelaySession` Durable Object per active hook URL
- One `Popularity` Durable Object for rolling 7 day counts
- One signing secret for stateless hook URLs and websocket tokens

## Development

```bash
npm install
npm run dev
```

Set the signing secret before deploying:

```bash
wrangler secret put RELAY_SIGNING_KEY
```

Then deploy:

```bash
npm run deploy
```

## OSS

- License: MIT
- Skill file source: `SKILL.md`
- Public skill route: `/skill.md`
