import { DurableObject } from "cloudflare:workers";

import { json } from "../lib/http";
import type { RelayDispatchResult, RelayEnvelope, RelayResponseMessage, RelaySessionStatus } from "../lib/protocol";
import { RESPONSE_TIMEOUT_MS } from "../lib/protocol";

type PendingRequest = {
  resolve: (value: RelayDispatchResult) => void;
  timer: ReturnType<typeof setTimeout>;
};

const textDecoder = new TextDecoder();

function envelopeIsSmoke(headers: Record<string, string>): boolean {
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === "x-webhookrelay-smoke" && value === "1") {
      return true;
    }
  }

  return false;
}

function readSocketMessage(message: string | ArrayBuffer | ArrayBufferView): string {
  if (typeof message === "string") {
    return message;
  }

  if (message instanceof ArrayBuffer) {
    return textDecoder.decode(message);
  }

  return textDecoder.decode(new Uint8Array(message.buffer, message.byteOffset, message.byteLength));
}

export class RelaySession extends DurableObject {
  private listener: WebSocket | null;
  private pending = new Map<string, PendingRequest>();
  private lastActivityAt: number | null = null;
  private ingressAt: number | null = null;
  private ingressSmokeAt: number | null = null;
  private ingressLiveAt: number | null = null;
  private forwardedAt: number | null = null;
  private listenerReplyAt: number | null = null;

  constructor(ctx: DurableObjectState, env: any) {
    super(ctx, env);

    const sockets = ctx.getWebSockets();
    this.listener = sockets.length > 0 ? sockets[sockets.length - 1] : null;

    for (let index = 0; index < sockets.length - 1; index += 1) {
      sockets[index].close(1012, "A newer listener connected.");
    }
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const isWebSocket = request.headers.get("upgrade")?.toLowerCase() === "websocket";

    if (isWebSocket) {
      return this.handleConnect();
    }

    if (request.method === "POST" && url.pathname === "/dispatch") {
      return this.handleDispatch(request);
    }

    if (request.method === "GET" && url.pathname === "/status") {
      return this.handleStatus();
    }

    return json({ ok: false, error: "Not found." }, { status: 404 });
  }

  private handleConnect(): Response {
    const pair = new WebSocketPair();
    const sockets = Object.values(pair);
    const client = sockets[0];
    const server = sockets[1];
    const previous = this.listener;

    this.ctx.acceptWebSocket(server);
    this.listener = server;

    if (previous) {
      previous.close(1012, "A newer listener connected.");
    }

    return new Response(null, {
      status: 101,
      webSocket: client,
    });
  }

  private latchIngress(envelope: RelayEnvelope): void {
    const now = Date.now();
    this.lastActivityAt = now;

    if (this.ingressAt === null) {
      this.ingressAt = now;
    }

    const smoke = envelopeIsSmoke(envelope.headers);

    if (smoke && this.ingressSmokeAt === null) {
      this.ingressSmokeAt = now;
    }

    if (!smoke && this.ingressLiveAt === null) {
      this.ingressLiveAt = now;
    }
  }

  private async handleDispatch(request: Request): Promise<Response> {
    let envelope: RelayEnvelope;

    try {
      envelope = (await request.json()) as RelayEnvelope;
    } catch {
      return json({ ok: false, error: "Invalid dispatch body." } satisfies RelayDispatchResult, { status: 400 });
    }

    this.latchIngress(envelope);

    if (!this.listener || this.listener.readyState !== WebSocket.OPEN) {
      this.listener = null;
      return json(
        {
          ok: false,
          error: "No local listener is connected.",
        } satisfies RelayDispatchResult,
        { status: 503 },
      );
    }

    try {
      const result = await new Promise<RelayDispatchResult>((resolve) => {
        const timer = setTimeout(() => {
          this.pending.delete(envelope.id);
          this.lastActivityAt = Date.now();
          resolve({
            ok: false,
            error: "The local listener did not answer in time.",
          });
        }, RESPONSE_TIMEOUT_MS);

        this.pending.set(envelope.id, { resolve, timer });

        if (this.forwardedAt === null) {
          this.forwardedAt = Date.now();
        }

        this.listener?.send(JSON.stringify(envelope));
      });

      this.lastActivityAt = Date.now();
      return json(result, { status: result.ok ? 200 : 504 });
    } catch {
      this.pending.delete(envelope.id);
      this.lastActivityAt = Date.now();

      return json(
        {
          ok: false,
          error: "The local listener closed before the webhook could be delivered.",
        } satisfies RelayDispatchResult,
        { status: 503 },
      );
    }
  }

  private handleStatus(): Response {
    const connected = Boolean(this.listener && this.listener.readyState === WebSocket.OPEN);

    if (!connected) {
      this.listener = null;
    }

    return json(
      {
        ok: true,
        connected,
        inFlightCount: this.pending.size,
        lastActivityAt: this.lastActivityAt,
        ingressAt: this.ingressAt,
        ingressSmokeAt: this.ingressSmokeAt,
        ingressLiveAt: this.ingressLiveAt,
        forwardedAt: this.forwardedAt,
        listenerReplyAt: this.listenerReplyAt,
      } satisfies RelaySessionStatus,
    );
  }

  webSocketMessage(_ws: WebSocket, message: string | ArrayBuffer | ArrayBufferView): void {
    let parsed: RelayResponseMessage;

    try {
      parsed = JSON.parse(readSocketMessage(message)) as RelayResponseMessage;
    } catch {
      return;
    }

    if (parsed.type !== "response") {
      return;
    }

    const pending = this.pending.get(parsed.id);

    if (!pending) {
      return;
    }

    this.lastActivityAt = Date.now();
    clearTimeout(pending.timer);
    this.pending.delete(parsed.id);

    if (this.listenerReplyAt === null) {
      this.listenerReplyAt = Date.now();
    }

    pending.resolve({
      ok: true,
      status: parsed.status,
      headers: parsed.headers,
      body: parsed.body,
    });
  }

  webSocketClose(ws: WebSocket): void {
    if (this.listener === ws) {
      this.listener = null;
      this.failPending("The local listener disconnected. Start the script again, then retry.");
    }
  }

  webSocketError(ws: WebSocket): void {
    if (this.listener === ws) {
      this.listener = null;
      this.failPending("The local listener hit an unexpected socket error. Start the script again, then retry.");
    }
  }

  private failPending(error: string): void {
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.resolve({
        ok: false,
        error,
      });
      this.pending.delete(id);
    }
  }
}
