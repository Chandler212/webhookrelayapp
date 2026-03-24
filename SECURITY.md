# Security Policy

## Supported versions

webhookrelay.app is a single-deployment hosted service. The version running at https://webhookrelay.app is the only supported version. This repository tracks the source code for that deployment.

## Threat model summary

- The webhook URL (`/h/…`) is HMAC-signed and treated as a secret. Anyone who possesses it can send traffic to your relay within the configured rate limits. Rotate by creating a new session.
- WebSocket listener tokens are time-limited (default 24 hours). Create a new session to get a fresh token.
- Webhook payloads are forwarded in memory only. The Durable Object does not use persistent storage for payload data.
- TLS terminates at Cloudflare. Request bodies are never logged in application code.
- The Worker drops all `cf-*` headers and standard hop-by-hop / forwarding headers before forwarding to localhost. Provider headers such as `Authorization` or `X-Hub-Signature` are forwarded to your local app — do not log them carelessly.

## Reporting a vulnerability

Please open an issue at https://github.com/Chandler212/webhookrelayapp/issues.

For sensitive disclosures, use [GitHub private vulnerability reporting](https://docs.github.com/code-security/security-advisories/guidance-on-reporting-and-writing-information-about-vulnerabilities/privately-reporting-a-security-vulnerability) if enabled on the repository, or email the maintainer listed in the repository profile.

Please include:

- A description of the vulnerability and potential impact
- Steps to reproduce
- Any suggested mitigations

We aim to acknowledge reports within 72 hours.
