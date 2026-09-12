import "server-only";
import { randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";

// Unambiguous character set — no 0/O, 1/I/l, to reduce transcription
// errors when someone reads this code aloud or types it on a phone.
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const CODE_LENGTH = 10;
const BCRYPT_SALT_ROUNDS = 12;

/**
 * Generates a new plaintext secret code. This is shown to the Admin
 * exactly once (at creation/rotation time) and never stored or logged
 * in plaintext anywhere — only its hash is persisted.
 */
export function generateSecretCode(): string {
  const bytes = randomBytes(CODE_LENGTH);
  let code = "";
  for (let i = 0; i < CODE_LENGTH; i++) {
    const byte = bytes.at(i);
    if (byte === undefined) {
      // Cannot happen — bytes.length === CODE_LENGTH by construction —
      // but this keeps the function honest under noUncheckedIndexedAccess
      // without reaching for a non-null assertion.
      throw new Error("Unexpected: randomBytes returned fewer bytes than requested");
    }
    code += CODE_ALPHABET[byte % CODE_ALPHABET.length];
  }
  return code;
}

export async function hashSecretCode(plaintext: string): Promise<string> {
  return bcrypt.hash(plaintext, BCRYPT_SALT_ROUNDS);
}

export async function verifySecretCode(
  plaintext: string,
  hash: string
): Promise<boolean> {
  return bcrypt.compare(plaintext, hash);
}
