# webhookrelay.app

Relay third-party webhooks to a local app over one outbound `wss` connection.

No tunnel. No reverse proxy. No generic ingress layer. Just a public webhook URL that forwards into `localhost`.

## What It Does

1. The homepage shows a large app grid sorted by rolling 7 day popularity.
2. Clicking an app creates a fresh relay session.
3. The modal gives you:
   - a public webhook URL
   - a single paste Node 22+ listener command with no npm packages
   - a `curl` smoke test
4. The listener opens one outbound websocket to `webhookrelay.app`.
5. Incoming webhooks are forwarded to your local URL and your local app's status code is sent back upstream.

## Local Listener

The generated listener is intentionally simple:

- Node 22+ only
- no npm install
- one paste command
- one `LOCAL_URL`
- automatic reconnect

## Routes

- `GET /` serves the app grid
- `GET /skill.md` serves the public skill file
- `GET /health` returns a small health payload
- `GET /api/apps` returns the sorted app catalog
- `POST /api/sessions` creates a fresh relay session
- `GET /api/session-status` returns listener connection state for the modal (authenticated)
- WebSocket upgrade to `/ws/:hookId` accepts the local listener
- `/h/:hookId` receives and forwards the third-party webhook (`GET`, `POST`, and other allowed methods)

## Rate limiting

Relay-heavy routes use the [Workers Rate Limiting API](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/) (`[[ratelimits]]` in `wrangler.toml`). There are three independent dimensions:

| Layer    | Key                        | Purpose                                                                                                      |
| -------- | -------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Global   | fixed `global`             | Caps total relay work per Cloudflare **PoP** (data center), not a single worldwide counter                   |
| Per IP   | `ip:` + `CF-Connecting-IP` | Caps abuse from one client address (falls back to `0.0.0.0` when the header is absent, e.g. some local runs) |
| Per hook | full signed `hookId`       | Caps traffic to one webhook URL; only applied **after** the hook ID passes cryptographic verification        |

**Counted routes:** `POST /api/sessions`, `GET /api/session-status`, WebSocket `/ws/*`, and `/h/*`. **Not counted:** `GET /health`, `GET /api/apps`, `GET /skill.md`, and static assets.

When a limit is exceeded the Worker returns **429** with the same JSON error shape as other API errors (`code` is `rate_limit_global`, `rate_limit_ip`, or `rate_limit_hook`) and a **`Retry-After`** header matching the configured window (**60** seconds in the default config).

**Tuning:** Edit `limit` and `period` (must be `10` or `60` seconds) under each `[[ratelimits]]` block. Use a unique `namespace_id` integer per binding on your Cloudflare account. Defaults in-repo: **10_000** global, **300** per-IP, **600** per-hook per window (all per PoP).

## Architecture

- One Cloudflare Worker for the site and API
- One `RelaySession` Durable Object per active hook URL
- One `Popularity` Durable Object for rolling 7 day counts
- One signing secret for stateless hook URLs and websocket tokens
- Three rate-limit namespaces (global, per-IP, per-hook) for relay routes

Session JSON includes `wsTokenExpiresInHours` (default 24): **websocket listener token** lifetime. The public webhook path `/h/:id` stays valid until you rotate `RELAY_SIGNING_KEY` (hook IDs are HMAC-signed, not time-limited in code).

## Data handling & privacy

**Relay path:** Webhook payloads are forwarded **in memory** only. The [`RelaySession`](src/durable/RelaySession.ts) Durable Object does **not** use `ctx.storage` for webhook data—no server-side archive or replay store in this codebase.

**What is stored:** Rolling **7-day popularity counts** per catalog `appId` only ([`Popularity`](src/durable/Popularity.ts)).

**Logging:** The Worker does not log request bodies. Uncaught errors log `requestId` and `error.message` only ([`src/index.ts`](src/index.ts)).

**Limits:** Max inbound body **512 KiB** ([`src/lib/protocol.ts`](src/lib/protocol.ts)); local listener must answer within **25s** for a single delivery.

**Platform:** Cloudflare **account** observability / edge logs ([`wrangler.toml`](wrangler.toml)) are separate from application storage—review your CF settings.

## Security notes

- Treat the **webhook URL** (`/h/...`) like a **secret**—anyone with it can trigger your relay (within rate limits).
- Generated **WebSocket URLs** may include `?token=`; prefer revoking by creating a new session if a URL leaks.
- **Inbound provider headers** (e.g. `Authorization`) are forwarded to your **local** URL—do not log them carelessly on your machine.
- **Reporting:** use the **`bugs` URL** in [`package.json`](package.json) (same as GitHub Issues for this repo). Repo owners can enable [GitHub private vulnerability reporting](https://docs.github.com/code-security/security-advisories/guidance-on-reporting-and-writing-information-about-vulnerabilities/privately-reporting-a-security-vulnerability) for a disclosure inbox.
- **Response headers to providers:** the bundled [`public/cli/webhookrelay.mjs`](public/cli/webhookrelay.mjs) forwards **`Content-Type` only** for live (non-smoke) replies. If you run a **custom** listener, the Worker applies a [hop-by-hop blocklist](src/lib/http.ts) but may still forward other response headers from your listener to the webhook sender—keep that in mind if you return sensitive headers.

## Development

```bash
npm install
npm run dev
```

Optional local sink: `npm run listen:local` runs [`scripts/local-webhook-listener.mjs`](scripts/local-webhook-listener.mjs) on port **3001** by default—set the modal **Local URL** to match (the homepage default is often `http://localhost:3000/...`).

Set the signing secret before deploying (stored in **Cloudflare**, not in this repo):

```bash
wrangler secret put RELAY_SIGNING_KEY
```

**GitHub Actions** ([`.github/workflows/deploy.yml`](.github/workflows/deploy.yml)) can deploy from the repo **Actions** tab (**Run workflow**). It does **not** run on push to `main`. Add `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` repository secrets if you use it. **`RELAY_SIGNING_KEY` is not passed from GitHub**—set it with `wrangler secret put` (or the dashboard) on your Worker. Otherwise deploy with `npm run deploy` locally.

Then deploy:

```bash
npm run deploy
```

## OSS

- License: MIT ([`LICENSE`](LICENSE))
- Skill file source: edit **`SKILL.md`** only; `npm run sync:skill` (or deploy) copies it to `public/skill.md` for `/skill.md`—that file may be gitignored, so treat **`SKILL.md`** as canonical on GitHub.
- **Repository / issues:** see `repository` and `bugs` in [`package.json`](package.json) (update URLs if you fork)
- App grid names are **third-party trademarks**; no affiliation or endorsement.

**Inspect the relay:** [`src/durable/RelaySession.ts`](src/durable/RelaySession.ts) (in-memory relay), [`src/durable/Popularity.ts`](src/durable/Popularity.ts) (counts only), [`src/index.ts`](src/index.ts) (Worker entry).
