import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

// AES-256-GCM sealed cookie values. The cookie name is bound in as associated data,
// so one sealed value can't be replayed under another cookie's name.

function key() {
  const secret = process.env.COOKIE_SECRET;
  if (!secret || secret.length < 32) throw new Error("COOKIE_SECRET is missing or shorter than 32 characters");
  return createHash("sha256").update(secret).digest();
}

export function seal(name: string, data: unknown): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  cipher.setAAD(Buffer.from(name));
  const body = Buffer.concat([cipher.update(JSON.stringify(data), "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), body]).toString("base64url");
}

export function unseal<T>(name: string, value: string | undefined): T | null {
  if (!value) return null;
  try {
    const raw = Buffer.from(value, "base64url");
    const decipher = createDecipheriv("aes-256-gcm", key(), raw.subarray(0, 12));
    decipher.setAAD(Buffer.from(name));
    decipher.setAuthTag(raw.subarray(12, 28));
    return JSON.parse(Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString("utf8"));
  } catch {
    return null; // tampered, wrong secret, or wrong cookie name
  }
}
