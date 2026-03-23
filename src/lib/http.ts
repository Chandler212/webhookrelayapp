const requestHeaderBlocklist = new Set([
  "accept-encoding",
  "connection",
  "content-length",
  "host",
  "upgrade",
  "x-forwarded-for",
  "x-forwarded-host",
  "x-forwarded-proto",
  "x-real-ip",
]);

const responseHeaderBlocklist = new Set([
  "connection",
  "content-length",
  "keep-alive",
  "transfer-encoding",
  "upgrade",
]);

export function toBase64(bytes: Uint8Array): string {
  const chunkSize = 0x8000;
  let binary = "";

  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }

  return btoa(binary);
}

export function fromBase64(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return bytes;
}

export function json(data: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json; charset=utf-8");
  return new Response(JSON.stringify(data), { ...init, headers });
}

export function errorResponse(status: number, code: string, message: string, nextStep: string, requestId: string): Response {
  return json(
    {
      ok: false,
      error: {
        code,
        message,
        nextStep,
        requestId,
      },
    },
    { status },
  );
}

export function sanitizeRequestHeaders(headers: Headers): Record<string, string> {
  const result: Record<string, string> = {};

  for (const [key, value] of headers) {
    const lowerKey = key.toLowerCase();

    if (requestHeaderBlocklist.has(lowerKey) || lowerKey.startsWith("cf-")) {
      continue;
    }

    result[key] = value;
  }

  return result;
}

export function sanitizeResponseHeaders(headers?: Record<string, string>): Headers {
  const result = new Headers();

  if (!headers) {
    return result;
  }

  for (const [key, value] of Object.entries(headers)) {
    const lowerKey = key.toLowerCase();

    if (responseHeaderBlocklist.has(lowerKey)) {
      continue;
    }

    result.set(key, value);
  }

  return result;
}
