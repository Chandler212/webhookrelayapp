import { DurableObject } from "cloudflare:workers";

import { json } from "../lib/http";
import type { RelayDispatchResult, RelayEnvelope, RelayResponseMessage } from "../lib/protocol";
import { RESPONSE_TIMEOUT_MS } from "../lib/protocol";

type PendingRequest = {
  resolve: (value: RelayDispatchResult) => void;
  timer: ReturnType<typeof setTimeout>;
};

const textDecoder = new TextDecoder();

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

  private async handleDispatch(request: Request): Promise<Response> {
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

    const envelope = (await request.json()) as RelayEnvelope;

    try {
      const result = await new Promise<RelayDispatchResult>((resolve) => {
        const timer = setTimeout(() => {
          this.pending.delete(envelope.id);
          resolve({
            ok: false,
            error: "The local listener did not answer in time.",
          });
        }, RESPONSE_TIMEOUT_MS);

        this.pending.set(envelope.id, { resolve, timer });
        this.listener?.send(JSON.stringify(envelope));
      });

      return json(result, { status: result.ok ? 200 : 504 });
    } catch {
      this.pending.delete(envelope.id);

      return json(
        {
          ok: false,
          error: "The local listener closed before the webhook could be delivered.",
        } satisfies RelayDispatchResult,
        { status: 503 },
      );
    }
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

    clearTimeout(pending.timer);
    this.pending.delete(parsed.id);
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
