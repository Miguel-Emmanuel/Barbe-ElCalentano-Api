import { createHash } from "crypto";

export function hashPassword(password: string): string {
  return createHash("sha256").update(`el-calentano:${password}`).digest("hex");
}
