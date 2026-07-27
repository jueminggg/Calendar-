import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "crypto";

// OAuth refresh tokens and CalDAV app-specific passwords are stored encrypted
// at rest (AES-256-GCM) using a key derived from ENCRYPTION_KEY, so a database
// leak alone doesn't hand over live access to someone's calendars.
const ALGO = "aes-256-gcm";

function getKey(): Buffer {
  const secret = process.env.ENCRYPTION_KEY;
  if (!secret) {
    throw new Error("ENCRYPTION_KEY environment variable is not set");
  }
  return scryptSync(secret, "calendar-sync-encryption", 32);
}

export function encrypt(plaintext: string): string {
  const key = getKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGO, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return [iv.toString("base64"), authTag.toString("base64"), ciphertext.toString("base64")].join(".");
}

export function decrypt(payload: string): string {
  const [ivB64, authTagB64, ciphertextB64] = payload.split(".");
  if (!ivB64 || !authTagB64 || !ciphertextB64) {
    throw new Error("Malformed encrypted payload");
  }
  const key = getKey();
  const decipher = createDecipheriv(ALGO, key, Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(authTagB64, "base64"));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(ciphertextB64, "base64")),
    decipher.final(),
  ]);
  return plaintext.toString("utf8");
}
