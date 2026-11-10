/**
 * License delivery for the Agentwright Starter, running on Cloudflare Pages Functions + KV.
 *
 * KV namespace `LICENSES` keys:
 *   license:<key>        JSON LicenseRecord
 *   order:<orderId>      the license key issued for an order (idempotency). Lemon Squeezy orders
 *                        use the numeric LS id; Polar orders use `polar:<order uuid>`
 *   asset:starter.zip    the downloadable source archive (uploaded via the KV REST API)
 *
 * Download links are `/api/download?token=<key>.<hmac>` where the HMAC is derived from
 * LEMONSQUEEZY_WEBHOOK_SECRET, so no second secret is needed.
 */

export interface LicenseEnv {
  LICENSES?: KVNamespace;
  LEMONSQUEEZY_WEBHOOK_SECRET?: string;
  /** Lemon Squeezy variant id of the Starter product; other variants are ignored. */
  LICENSE_VARIANT_ID?: string;
  /** Optional: redirect downloads here instead of serving `asset:starter.zip` from KV. */
  LICENSE_DOWNLOAD_URL?: string;
}

export interface LicenseRecord {
  key: string;
  status: "active" | "revoked";
  orderId: string;
  orderNumber: string | null;
  orderIdentifier: string | null;
  email: string;
  name: string | null;
  variantId: string | null;
  testMode: boolean;
  downloadUrl: string;
  emailSent: boolean;
  /** Resend message id once the license email went out. */
  emailId?: string;
  emailSentAt?: string;
  /** Last delivery error (kept so a retry or the inbox routine can spot it). */
  emailError?: string;
  createdAt: string;
  revokedAt?: string;
  /** Which seller sold it. Missing on records created before Polar existed (= Lemon Squeezy). */
  source?: "lemonsqueezy" | "polar";
}

const enc = new TextEncoder();

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
}

async function hmac(secret: string, message: string): Promise<Uint8Array> {
  const sig = await crypto.subtle.sign("HMAC", await hmacKey(secret), enc.encode(message));
  return new Uint8Array(sig);
}

const toHex = (bytes: Uint8Array) => [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");

function toBase64Url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Lemon Squeezy signs the raw body with HMAC-SHA256 and sends the hex digest in `X-Signature`. */
export async function verifyLemonSqueezySignature(rawBody: string, signature: string | null, secret: string) {
  if (!signature) return false;
  const expected = toHex(await hmac(secret, rawBody));
  return constantTimeEqual(expected, signature.trim().toLowerCase());
}

/**
 * Polar signs deliveries with Standard Webhooks: `webhook-signature: v1,<base64 HMAC-SHA256>` over
 * `${webhook-id}.${webhook-timestamp}.${rawBody}`. Mirrors @polar-sh/sdk validateWebhook: the HMAC
 * key is the UTF-8 bytes of the full secret, or its base64-decoded form (after an optional
 * `whsec_` prefix). Timestamps more than 5 minutes off are rejected (replay protection).
 */
export async function verifyStandardWebhookSignature(
  rawBody: string,
  headers: Headers,
  secret: string,
  nowSeconds = Date.now() / 1000,
): Promise<boolean> {
  const id = headers.get("webhook-id");
  const ts = headers.get("webhook-timestamp");
  const sigHeader = headers.get("webhook-signature");
  if (!secret || !id || !ts || !sigHeader) return false;
  const timestamp = Number(ts);
  if (!Number.isFinite(timestamp) || Math.abs(nowSeconds - timestamp) > 300) return false;

  const keys: Uint8Array[] = [enc.encode(secret)];
  const decoded = decodeBase64(secret.startsWith("whsec_") ? secret.slice(6) : secret);
  if (decoded && decoded.byteLength > 0 && toHex(decoded) !== toHex(keys[0])) keys.push(decoded);

  const signed = `${id}.${Math.floor(timestamp)}.${rawBody}`;
  const expected = await Promise.all(
    keys.map(async (k) => {
      const ck = await crypto.subtle.importKey("raw", k, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
      return btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.sign("HMAC", ck, enc.encode(signed)))));
    }),
  );
  for (const part of sigHeader.split(" ")) {
    const [version, sig] = part.split(",", 2);
    if (version !== "v1" || !sig) continue;
    if (expected.some((e) => constantTimeEqual(e, sig))) return true;
  }
  return false;
}

function decodeBase64(value: string): Uint8Array | null {
  try {
    const s = atob(value);
    return Uint8Array.from(s, (c) => c.charCodeAt(0));
  } catch {
    return null;
  }
}

/** Keys look like AW-7K3M-Q9XD-2HBN-W4PC (no 0/O/1/I to avoid support emails). */
export function generateLicenseKey(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  const chars = [...bytes].map((b) => alphabet[b % alphabet.length]);
  const groups = [0, 4, 8, 12].map((i) => chars.slice(i, i + 4).join(""));
  return `AW-${groups.join("-")}`;
}

export async function signDownloadToken(key: string, secret: string): Promise<string> {
  return `${key}.${toBase64Url(await hmac(secret, `download:${key}`))}`;
}

/** Returns the license key when the token is well-formed and the signature matches. */
export async function verifyDownloadToken(token: string, secret: string): Promise<string | null> {
  const dot = token.lastIndexOf(".");
  if (dot <= 0) return null;
  const key = token.slice(0, dot);
  if (!/^AW(-[A-Z0-9]{4}){4}$/.test(key)) return null;
  const expected = toBase64Url(await hmac(secret, `download:${key}`));
  return constantTimeEqual(expected, token.slice(dot + 1)) ? key : null;
}

export const getLicense = (kv: KVNamespace, key: string) => kv.get<LicenseRecord>(`license:${key}`, "json");

export async function saveLicense(kv: KVNamespace, record: LicenseRecord) {
  await kv.put(`license:${record.key}`, JSON.stringify(record));
  await kv.put(`order:${record.orderId}`, record.key);
}
