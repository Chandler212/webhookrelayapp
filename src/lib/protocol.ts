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
