# Changelog

All notable changes to this project will be documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

## [0.1.0] — 2026-03-23

### Added

- Cloudflare Worker serving the static app, API, and relay routes
- `RelaySession` Durable Object: in-memory relay per active hook URL; no payload storage
- `Popularity` Durable Object: rolling 7-day popularity counts per catalog `appId`
- HMAC-signed stateless hook URLs (`/h/:hookId`) — valid until signing key rotation
- WebSocket listener endpoint (`/ws/:hookId`) with time-limited tokens (default 24 h)
- One-paste Node 22+ local listener — no npm install, automatic reconnect
- Thin optional CLI (`public/cli/webhookrelay.mjs`) downloadable via `curl`
- Smoke test `curl` command embedded in the session modal
- Three-layer rate limiting: global per-PoP, per client IP, per hook URL
- Per-PoP 429 responses with `Retry-After` header
- Request header sanitisation: strips hop-by-hop, forwarding, `host`, `content-length`, `accept-encoding`, `upgrade`, and all `cf-*` headers
- Response header sanitisation: strips hop-by-hop headers before forwarding to webhook sender
- 512 KiB max inbound body limit (`src/lib/protocol.ts`)
- 25 s local response timeout with 504 returned to sender on expiry
- 503 returned to sender when no listener is connected or listener disconnects mid-flight
- Session status API (`GET /api/session-status`) for modal progress tracking
- App catalog API (`GET /api/apps`) sorted by rolling popularity
- GitHub Actions deploy workflow (manual trigger)
- MIT license
