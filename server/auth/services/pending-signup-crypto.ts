const ENC_ALGO = "AES-GCM";
const IV_LEN = 12;

async function deriveKey(secret: string): Promise<CryptoKey> {
  const hash = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`${secret}:museum-pending-signup:v1`),
  );
  return crypto.subtle.importKey("raw", hash, ENC_ALGO, false, ["encrypt", "decrypt"]);
}

export async function encryptPassword(secret: string, password: string): Promise<string> {
  const key = await deriveKey(secret);
  const iv = crypto.getRandomValues(new Uint8Array(IV_LEN));
  const cipher = await crypto.subtle.encrypt(
    { name: ENC_ALGO, iv },
    key,
    new TextEncoder().encode(password),
  );
  const payload = {
    iv: Array.from(iv),
    data: Array.from(new Uint8Array(cipher)),
  };
  return btoa(JSON.stringify(payload));
}

export async function decryptPassword(secret: string, encoded: string): Promise<string> {
  const payload = JSON.parse(atob(encoded)) as { iv: number[]; data: number[] };
  const key = await deriveKey(secret);
  const plain = await crypto.subtle.decrypt(
    { name: ENC_ALGO, iv: new Uint8Array(payload.iv) },
    key,
    new Uint8Array(payload.data),
  );
  return new TextDecoder().decode(plain);
}

export async function hashToken(secret: string, value: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value));
  return btoa(String.fromCharCode(...new Uint8Array(sig)));
}

export async function verifyTokenHash(
  secret: string,
  value: string,
  expected: string,
): Promise<boolean> {
  const actual = await hashToken(secret, value);
  if (actual.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < actual.length; i++) diff |= actual.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

export function generateOtp(length = 6): string {
  const max = 10 ** length;
  const n = crypto.getRandomValues(new Uint32Array(1))[0] % max;
  return String(n).padStart(length, "0");
}

export function generateLinkToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}
