/**
 * Standard Webhooks signature verification (https://www.standardwebhooks.com).
 *
 * Gemini's batch webhooks are signed using this scheme. Each delivery carries
 * three headers — `webhook-id`, `webhook-timestamp`, `webhook-signature` — and
 * the signature is an HMAC-SHA256 over `${id}.${timestamp}.${rawBody}`, keyed
 * by the signing secret returned when the webhook was registered
 * (`webhook.new_signing_secret`, stored as WEBHOOK_SIGNING_SECRET).
 *
 * Implemented with Web Crypto so it runs natively on Cloudflare Workers without
 * a Node `crypto` dependency.
 */

// Reject deliveries whose timestamp is too far from now, to limit replay.
const DEFAULT_TOLERANCE_SECONDS = 5 * 60;

// Standard Webhooks secrets are base64, conventionally prefixed with `whsec_`.
const SECRET_PREFIX = "whsec_";

function base64ToArrayBuffer(b64: string): ArrayBuffer {
  const binary = atob(b64);
  const buffer = new ArrayBuffer(binary.length);
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return buffer;
}

function bytesToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

// Length-independent equality to avoid leaking timing information.
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return mismatch === 0;
}

async function importHmacKey(secret: string): Promise<CryptoKey> {
  const raw = secret.startsWith(SECRET_PREFIX) ? secret.slice(SECRET_PREFIX.length) : secret;
  return crypto.subtle.importKey(
    "raw",
    base64ToArrayBuffer(raw),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
}

/**
 * Compute the base64 HMAC-SHA256 signature for a webhook delivery.
 * Exported so tests can produce valid signatures for round-trip verification.
 */
export async function computeSignature(
  secret: string,
  id: string,
  timestamp: string,
  payload: string
): Promise<string> {
  const key = await importHmacKey(secret);
  const data = new TextEncoder().encode(`${id}.${timestamp}.${payload}`);
  const signature = await crypto.subtle.sign("HMAC", key, data);
  return bytesToBase64(signature);
}

export interface VerifyWebhookOptions {
  secret: string;
  /** The exact raw request body — verification fails if it is re-serialized. */
  payload: string;
  headers: {
    id: string | null;
    timestamp: string | null;
    signature: string | null;
  };
  /** Current time in seconds; injectable for tests. */
  nowSeconds?: number;
  toleranceSeconds?: number;
}

/**
 * Verify a Standard Webhooks signed request. Returns true only when the
 * required headers are present, the timestamp is within tolerance, and at least
 * one provided `v1` signature matches our computed signature.
 */
export async function verifyStandardWebhook(opts: VerifyWebhookOptions): Promise<boolean> {
  const { secret, payload } = opts;
  const { id, timestamp, signature } = opts.headers;

  if (!secret || !id || !timestamp || !signature) return false;

  const ts = Number(timestamp);
  if (!Number.isFinite(ts)) return false;

  const now = opts.nowSeconds ?? Math.floor(Date.now() / 1000);
  const tolerance = opts.toleranceSeconds ?? DEFAULT_TOLERANCE_SECONDS;
  if (Math.abs(now - ts) > tolerance) return false;

  const expected = await computeSignature(secret, id, timestamp, payload);

  // The header is a space-delimited list of `version,signature` pairs.
  for (const token of signature.split(" ")) {
    const commaIndex = token.indexOf(",");
    if (commaIndex === -1) continue;
    const version = token.slice(0, commaIndex);
    const provided = token.slice(commaIndex + 1);
    if (version === "v1" && timingSafeEqual(provided, expected)) {
      return true;
    }
  }
  return false;
}
