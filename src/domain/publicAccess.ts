import { randomBytes } from "crypto";

/** No 0/O or 1/I, so the code is easy to read aloud. */
export const PUBLIC_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function makePublicCode(random: Uint8Array = randomBytes(6)): string {
  let code = "";
  for (let i = 0; i < 6; i += 1) {
    code += PUBLIC_CODE_ALPHABET[random[i]! % PUBLIC_CODE_ALPHABET.length];
  }
  return code;
}

export function makePublicToken(): string {
  return randomBytes(24).toString("base64url");
}

export function normalizePublicCode(raw: string): string {
  return raw.trim().toUpperCase().replace(/[\s-]/g, "");
}
