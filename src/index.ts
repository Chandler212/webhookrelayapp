import { APPS, appById, type AppCatalogItem } from "./catalog/apps";
import { Popularity } from "./durable/Popularity";
import { RelaySession } from "./durable/RelaySession";
import { createHookId, createWsToken, readHookId, verifyWsToken } from "./lib/auth";
import { errorResponse, fromBase64, json, sanitizeRequestHeaders, sanitizeResponseHeaders, toBase64 } from "./lib/http";
import type { RelayDispatchResult, RelayEnvelope } from "./lib/protocol";
import { MAX_WEBHOOK_BYTES } from "./lib/protocol";

export { Popularity, RelaySession };

export interface Env {
  ASSETS: Fetcher;
  POPULARITY: DurableObjectNamespace;
  RELAY_SESSIONS: DurableObjectNamespace;
  RELAY_SIGNING_KEY: string;
}

interface AppResponseItem extends AppCatalogItem {
  popularity7d: number;
}

const allowedWebhookMethods = new Set(["DELETE", "GET", "HEAD", "OPTIONS", "PATCH", "POST", "PUT"]);

function wsOriginFor(request: Request): string {
  const origin = new URL(request.url).origin;
  return origin.startsWith("https://")
    ? origin.replace("https://", "wss://")
    : origin.replace("http://", "ws://");
}

function getSigningKey(env: Env, request: Request): string | null {
  if (env.RELAY_SIGNING_KEY) {
    return env.RELAY_SIGNING_KEY;
  }

  const hostname = new URL(request.url).hostname;
  if (hostname === "localhost" || hostname === "127.0.0.1") {
    return "local-dev-signing-key";
  }

  return null;
}

async function getPopularityScores(env: Env): Promise<Record<string, number>> {
  const stub = env.POPULARITY.get(env.POPULARITY.idFromName("global"));
  const response = await stub.fetch("https://popularity.internal/scores");

  if (!response.ok) {
    return {};
  }

  const payload = (await response.json()) as { scores?: Record<string, number> };
  return payload.scores ?? {};
}

async function incrementPopularity(env: Env, appId: string): Promise<void> {
  const stub = env.POPULARITY.get(env.POPULARITY.idFromName("global"));
  await stub.fetch("https://popularity.internal/increment", {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({ appId }),
  });
}

function sortApps(left: AppResponseItem, right: AppResponseItem): number {
  return (
    right.popularity7d - left.popularity7d ||
    left.featuredRank - right.featuredRank ||
    left.name.localeCompare(right.name)
  );
}

function parseHookIdFromPath(pathname: string): string | null {
  const parts = pathname.split("/").filter(Boolean);
  return parts.length === 2 ? decodeURIComponent(parts[1]) : null;
}

function extractWsToken(request: Request): string | null {
  const url = new URL(request.url);
  const queryToken = url.searchParams.get("token");

  if (queryToken) {
    return queryToken;
  }

  const header = request.headers.get("authorization");

  if (!header?.startsWith("Bearer ")) {
    return null;
  }

  return header.slice("Bearer ".length).trim();
}

async function serveSkill(request: Request, env: Env): Promise<Response> {
  const asset = await env.ASSETS.fetch(request);
  const headers = new Headers(asset.headers);
  headers.set("content-type", "text/markdown; charset=utf-8");
  return new Response(asset.body, {
    status: asset.status,
    headers,
  });
}

async function handleApps(env: Env): Promise<Response> {
  const scores = await getPopularityScores(env);
  const items = APPS.map((app) => ({
    ...app,
    popularity7d: scores[app.id] ?? 0,
  })).sort(sortApps);

  return json({
    ok: true,
    items,
    total: items.length,
    sort: "rolling-7-day-popularity",
  });
}

async function handleSession(request: Request, env: Env, ctx: ExecutionContext, requestId: string): Promise<Response> {
  const signingKey = getSigningKey(env, request);

  if (!signingKey) {
    return errorResponse(500, "missing_signing_key", "The relay signing key is not configured.", "Set RELAY_SIGNING_KEY, then retry.", requestId);
  }

  const body = (await request.json().catch(() => null)) as { appId?: string } | null;
  const appId = body?.appId?.trim();

  if (!appId) {
    return errorResponse(400, "missing_app", "Pick an app card first.", "Choose an app from the grid, then try again.", requestId);
  }

  const app = appById.get(appId);

  if (!app) {
    return errorResponse(404, "unknown_app", "That app card is not available.", "Pick a different app card, then try again.", requestId);
  }

  const hookId = await createHookId(signingKey, app.id);
  const wsToken = await createWsToken(signingKey, hookId);
  const origin = new URL(request.url).origin;

  ctx.waitUntil(incrementPopularity(env, app.id));

  return json({
    ok: true,
    app,
    session: {
      hookId,
      hookUrl: `${origin}/h/${encodeURIComponent(hookId)}`,
      wsUrl: `${wsOriginFor(request).replace(/\/$/, "")}/ws/${encodeURIComponent(hookId)}?token=${encodeURIComponent(wsToken)}`,
      wsToken,
      listenerRuntime: "node-22+",
      expiresInHours: 24,
    },
  });
}

async function handleSocket(request: Request, env: Env, requestId: string): Promise<Response> {
  const signingKey = getSigningKey(env, request);

  if (!signingKey) {
    return errorResponse(500, "missing_signing_key", "The relay signing key is not configured.", "Set RELAY_SIGNING_KEY, then retry.", requestId);
  }

  if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") {
    return errorResponse(426, "upgrade_required", "Use a websocket client for this route.", "Run the listener script from the modal, then try again.", requestId);
  }

  const hookId = parseHookIdFromPath(new URL(request.url).pathname);

  if (!hookId) {
    return errorResponse(404, "missing_hook", "That listener URL is incomplete.", "Generate a fresh session from the homepage, then try again.", requestId);
  }

  if (!(await readHookId(signingKey, hookId))) {
    return errorResponse(404, "unknown_hook", "That listener URL is no longer valid.", "Generate a fresh session from the homepage, then try again.", requestId);
  }

  const token = extractWsToken(request);

  if (!token || !(await verifyWsToken(signingKey, hookId, token))) {
    return errorResponse(401, "bad_token", "That listener token is invalid or expired.", "Create a fresh session from the homepage, then rerun the listener script.", requestId);
  }

  const stub = env.RELAY_SESSIONS.get(env.RELAY_SESSIONS.idFromName(hookId));
  return stub.fetch(new Request("https://relay.internal/socket", request));
}

async function handleWebhook(request: Request, env: Env, requestId: string): Promise<Response> {
  const signingKey = getSigningKey(env, request);

  if (!signingKey) {
    return errorResponse(500, "missing_signing_key", "The relay signing key is not configured.", "Set RELAY_SIGNING_KEY, then retry.", requestId);
  }

  if (!allowedWebhookMethods.has(request.method)) {
    return errorResponse(405, "method_not_allowed", "That webhook method is not supported.", "Send the webhook with a standard HTTP method, then try again.", requestId);
  }

  const hookId = parseHookIdFromPath(new URL(request.url).pathname);

  if (!hookId) {
    return errorResponse(404, "missing_hook", "That webhook URL is incomplete.", "Create a fresh session from the homepage, then try again.", requestId);
  }

  const hook = await readHookId(signingKey, hookId);

  if (!hook) {
    return errorResponse(404, "unknown_hook", "That webhook URL is no longer valid.", "Create a fresh session from the homepage, then paste the new URL into your app.", requestId);
  }

  const app = appById.get(hook.appId);
  const bodyBytes = request.method === "GET" || request.method === "HEAD" ? new Uint8Array() : new Uint8Array(await request.arrayBuffer());

  if (bodyBytes.byteLength > MAX_WEBHOOK_BYTES) {
    return errorResponse(
      413,
      "payload_too_large",
      `Webhookrelay currently supports payloads up to ${Math.floor(MAX_WEBHOOK_BYTES / 1024)} KB.`,
      "Send a smaller payload or trim the event body, then try again.",
      requestId,
    );
  }

  const envelope: RelayEnvelope = {
    type: "webhook",
    id: requestId,
    appId: hook.appId,
    appName: app?.name ?? "Webhook",
    method: request.method,
    search: new URL(request.url).search,
    headers: sanitizeRequestHeaders(request.headers),
    body: bodyBytes.byteLength > 0 ? toBase64(bodyBytes) : undefined,
    bodySize: bodyBytes.byteLength,
    receivedAt: new Date().toISOString(),
  };

  const stub = env.RELAY_SESSIONS.get(env.RELAY_SESSIONS.idFromName(hookId));
  const dispatch = await stub.fetch("https://relay.internal/dispatch", {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify(envelope),
  });

  if (!dispatch.ok) {
    const payload = (await dispatch.json().catch(() => null)) as RelayDispatchResult | null;
    const message = payload?.error ?? "The local listener did not complete the relay.";

    if (dispatch.status === 503) {
      return errorResponse(
        503,
        "listener_offline",
        message,
        `Start the ${app?.name ?? "local"} listener script, then send the webhook again.`,
        requestId,
      );
    }

    return errorResponse(
      504,
      "listener_timeout",
      message,
      "Make sure your local app answers quickly, then send the webhook again.",
      requestId,
    );
  }

  const result = (await dispatch.json()) as RelayDispatchResult;
  const headers = sanitizeResponseHeaders(result.headers);
  headers.set("x-webhookrelay-id", requestId);

  if (!headers.has("content-type")) {
    headers.set("content-type", "text/plain; charset=utf-8");
  }

  const body =
    request.method === "HEAD" || !result.body
      ? null
      : new Blob([fromBase64(result.body)]);

  return new Response(body, {
    status: result.status ?? 200,
    headers,
  });
}

async function routeRequest(request: Request, env: Env, ctx: ExecutionContext, requestId: string): Promise<Response> {
  const url = new URL(request.url);

  if (request.method === "GET" && url.pathname === "/health") {
    return json({
      ok: true,
      name: "webhookrelay.app",
      requestId,
      time: new Date().toISOString(),
    });
  }

  if (request.method === "GET" && url.pathname === "/api/apps") {
    return handleApps(env);
  }

  if (request.method === "POST" && url.pathname === "/api/sessions") {
    return handleSession(request, env, ctx, requestId);
  }

  if (url.pathname.startsWith("/ws/")) {
    return handleSocket(request, env, requestId);
  }

  if (url.pathname.startsWith("/h/")) {
    return handleWebhook(request, env, requestId);
  }

  if (request.method === "GET" && url.pathname === "/skill.md") {
    return serveSkill(request, env);
  }

  if (url.pathname.startsWith("/api/")) {
    return errorResponse(404, "not_found", "That API route does not exist.", "Go back to the homepage and start a new relay session.", requestId);
  }

  return env.ASSETS.fetch(request);
}

export default {
  async fetch(request, env, ctx) {
    const requestId = crypto.randomUUID();

    try {
      return await routeRequest(request, env, ctx, requestId);
    } catch (error) {
      console.error("request_failed", {
        requestId,
        error: error instanceof Error ? error.message : String(error),
      });

      return errorResponse(
        500,
        "internal_error",
        "Webhookrelay hit an unexpected error.",
        "Retry once. If it still fails, create a fresh session from the homepage.",
        requestId,
      );
    }
  },
} satisfies ExportedHandler<Env>;
