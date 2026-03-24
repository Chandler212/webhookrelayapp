import { json } from "./http";

/** Matches `period` in wrangler.toml ratelimits (seconds). */
export const RATE_LIMIT_PERIOD_SECONDS = 60;

export interface RateLimitEnv {
  RATE_LIMIT_GLOBAL: RateLimit;
  RATE_LIMIT_IP: RateLimit;
  RATE_LIMIT_HOOK: RateLimit;
}

export function clientIp(request: Request): string {
  return request.headers.get("CF-Connecting-IP")?.trim() || "0.0.0.0";
}

function rateLimitJson(
  code: "rate_limit_global" | "rate_limit_ip" | "rate_limit_hook",
  message: string,
  nextStep: string,
  requestId: string,
): Response {
  const body = json(
    {
      ok: false,
      error: {
        code,
        message,
        nextStep,
        requestId,
      },
    },
    { status: 429 },
  );
  const headers = new Headers(body.headers);
  headers.set("retry-after", String(RATE_LIMIT_PERIOD_SECONDS));
  return new Response(body.body, { status: 429, headers });
}

/** Shared relay cap (per PoP) plus per-IP. Use before hook-specific crypto where possible. */
export async function enforceGlobalAndIpLimits(
  env: RateLimitEnv,
  request: Request,
  requestId: string,
): Promise<Response | null> {
  const globalOutcome = await env.RATE_LIMIT_GLOBAL.limit({ key: "global" });

  if (!globalOutcome.success) {
    return rateLimitJson(
      "rate_limit_global",
      "Too many relay requests from the network right now.",
      "Wait a minute, then retry.",
      requestId,
    );
  }

  const ipKey = `ip:${clientIp(request)}`;
  const ipOutcome = await env.RATE_LIMIT_IP.limit({ key: ipKey });

  if (!ipOutcome.success) {
    return rateLimitJson(
      "rate_limit_ip",
      "Too many relay requests from your address right now.",
      "Wait a minute, then retry.",
      requestId,
    );
  }

  return null;
}

/** Per-hook cap. Only call after hookId is cryptographically valid. */
export async function enforceHookLimit(env: RateLimitEnv, requestId: string, hookId: string): Promise<Response | null> {
  const hookOutcome = await env.RATE_LIMIT_HOOK.limit({ key: hookId });

  if (!hookOutcome.success) {
    return rateLimitJson(
      "rate_limit_hook",
      "Too many requests for this webhook URL right now.",
      "Wait a minute, then retry.",
      requestId,
    );
  }

  return null;
}
