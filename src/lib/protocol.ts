export const MAX_WEBHOOK_BYTES = 512 * 1024;
export const RESPONSE_TIMEOUT_MS = 25_000;

export interface RelayEnvelope {
  type: "webhook";
  id: string;
  appId: string;
  appName: string;
  method: string;
  search: string;
  headers: Record<string, string>;
  body?: string;
  bodySize: number;
  receivedAt: string;
}

export interface RelayResponseMessage {
  type: "response";
  id: string;
  status: number;
  headers?: Record<string, string>;
  body?: string;
}

export interface RelayDispatchResult {
  ok: boolean;
  status?: number;
  headers?: Record<string, string>;
  body?: string;
  error?: string;
}

export interface RelaySessionStatus {
  ok: true;
  connected: boolean;
  inFlightCount: number;
  lastActivityAt: number | null;
  /** First HTTP webhook accepted at /h/:id (dispatch entered). */
  ingressAt: number | null;
  /** First ingress that carried X-Webhookrelay-Smoke: 1. */
  ingressSmokeAt: number | null;
  /** First ingress without the smoke header. */
  ingressLiveAt: number | null;
  /** First time an envelope was sent to the listener WebSocket. */
  forwardedAt: number | null;
  /** First WebSocket `response` from the listener for a pending dispatch. */
  listenerReplyAt: number | null;
}
