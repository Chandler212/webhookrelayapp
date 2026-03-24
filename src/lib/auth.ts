const encoder = new TextEncoder();
const keyCache = new Map<string, Promise<CryptoKey>>();

interface HookPayload {
  nonce: string;
  appId: string;
  iat: number;
}

interface WsPayload {
  aud: "ws";
  hookId: string;
  iat: number;
  exp: number;
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";

  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function fromBase64Url(value: string): Uint8Array {
  const padded = value.replaceAll("-", "+").replaceAll("_", "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return bytes;
}

function encodeJson(payload: object): string {
  return toBase64Url(encoder.encode(JSON.stringify(payload)));
}

function decodeJson<T>(payload: string): T | null {
  try {
    return JSON.parse(new TextDecoder().decode(fromBase64Url(payload))) as T;
  } catch {
    return null;
  }
}

function constantTimeEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) {
    return false;
  }

  let result = 0;

  for (let index = 0; index < left.length; index += 1) {
    result |= left[index] ^ right[index];
  }

  return result === 0;
}

async function getKey(secret: string): Promise<CryptoKey> {
  const cached = keyCache.get(secret);

  if (cached) {
    return cached;
  }

  const imported = crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );

  keyCache.set(secret, imported);
  return imported;
}

async function sign(secret: string, purpose: string, payload: string): Promise<Uint8Array> {
  const key = await getKey(secret);
  const bytes = encoder.encode(`${purpose}.${payload}`);
  const signature = await crypto.subtle.sign("HMAC", key, bytes);
  return new Uint8Array(signature);
}

async function verify(secret: string, purpose: string, payload: string, signature: string): Promise<boolean> {
  let actual: Uint8Array;

  try {
    actual = fromBase64Url(signature);
  } catch {
    return false;
  }

  const expected = await sign(secret, purpose, payload);
  return constantTimeEqual(expected, actual);
}

export async function createHookId(secret: string, appId: string): Promise<string> {
  const payload = encodeJson({
    nonce: crypto.randomUUID().replaceAll("-", ""),
    appId,
    iat: Date.now(),
  } satisfies HookPayload);

  const signature = toBase64Url(await sign(secret, "hook", payload));
  return `h1.${payload}.${signature}`;
}

export async function readHookId(secret: string, hookId: string): Promise<HookPayload | null> {
  const [version, payload, signature] = hookId.split(".");

  if (version !== "h1" || !payload || !signature) {
    return null;
  }

  const parsed = decodeJson<HookPayload>(payload);

  if (!parsed?.nonce || !parsed.appId || typeof parsed.iat !== "number") {
    return null;
  }

  if (!(await verify(secret, "hook", payload, signature))) {
    return null;
  }

  return parsed;
}

export async function verifyHookId(secret: string, hookId: string): Promise<boolean> {
  return (await readHookId(secret, hookId)) !== null;
}

export async function createWsToken(secret: string, hookId: string): Promise<string> {
  const issuedAt = Math.floor(Date.now() / 1000);
  const payload = encodeJson({
    aud: "ws",
    hookId,
    iat: issuedAt,
    exp: issuedAt + 60 * 60 * 24,
  } satisfies WsPayload);

  const signature = toBase64Url(await sign(secret, "ws", payload));
  return `w1.${payload}.${signature}`;
}

export async function verifyWsToken(secret: string, hookId: string, token: string): Promise<boolean> {
  const [version, payload, signature] = token.split(".");

  if (version !== "w1" || !payload || !signature) {
    return false;
  }

  const parsed = decodeJson<WsPayload>(payload);

  if (!parsed || parsed.aud !== "ws" || parsed.hookId !== hookId) {
    return false;
  }

  if (parsed.exp < Math.floor(Date.now() / 1000)) {
    return false;
  }

  return await verify(secret, "ws", payload, signature);
}
