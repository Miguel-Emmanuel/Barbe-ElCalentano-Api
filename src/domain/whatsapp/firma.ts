import { createHmac, timingSafeEqual } from "node:crypto";

/** Compara X-Hub-Signature-256 con el cuerpo crudo y el App Secret. */
export function firmaValida(
  cuerpo: Buffer,
  encabezado: string | undefined,
  secreto: string,
): boolean {
  if (!secreto || !encabezado?.startsWith("sha256=")) return false;
  const recibida = encabezado.slice("sha256=".length).trim();
  const esperada = createHmac("sha256", secreto).update(cuerpo).digest("hex");
  const a = Buffer.from(esperada);
  const b = Buffer.from(recibida);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

const TOLERANCIA_YCLOUD_SEGUNDOS = 300;

/** YCloud-Signature: t=SEGUNDOS,s=HEX. Firma = HMAC-SHA256(secreto, "t." + cuerpo crudo). */
export function firmaYCloudValida(
  cuerpo: Buffer,
  encabezado: string | undefined,
  secreto: string,
  ahoraMs: number = Date.now(),
): boolean {
  if (!secreto || !encabezado) return false;
  const campos = encabezado.split(",").map((parte) => parte.trim().split("="));
  const tiempos = campos.filter(([clave]) => clave === "t").map(([, valor]) => valor);
  const firmas = campos.filter(([clave]) => clave === "s").map(([, valor]) => valor);
  if (tiempos.length !== 1 || !/^\d+$/.test(tiempos[0] ?? "")) return false;
  const tiempo = tiempos[0] as string;
  if (Math.abs(Math.floor(ahoraMs / 1000) - Number(tiempo)) > TOLERANCIA_YCLOUD_SEGUNDOS) return false;
  const esperada = createHmac("sha256", secreto).update(`${tiempo}.`).update(cuerpo).digest();
  return firmas.some(
    (firma) =>
      typeof firma === "string" &&
      /^[a-fA-F0-9]{64}$/.test(firma) &&
      timingSafeEqual(esperada, Buffer.from(firma, "hex")),
  );
}

export function secretoCoincide(recibido: string, esperado: string): boolean {
  if (!esperado || !recibido) return false;
  const a = Buffer.from(esperado);
  const b = Buffer.from(recibido);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
