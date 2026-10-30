/**
 * Celular de México listo para Cloud API.
 * Meta ya no usa el 1 de móvil: el destino es 52 + 10 dígitos.
 */

export function digitosNacionales(crudo: string | null | undefined): string | null {
  if (!crudo) return null;
  const digitos = crudo.replace(/\D/g, "");
  let nacional = digitos;
  if (digitos.length === 13 && digitos.startsWith("521")) nacional = digitos.slice(3);
  else if (digitos.length === 12 && digitos.startsWith("52")) nacional = digitos.slice(2);
  if (!/^\d{10}$/.test(nacional)) return null;
  return nacional;
}

/** E.164 con signo, por ejemplo +525511122233. */
export function telefonoE164(crudo: string | null | undefined): string | null {
  const nacional = digitosNacionales(crudo);
  return nacional ? `+52${nacional}` : null;
}

/** Campo `to` de Cloud API: 525511122233, sin signo. */
export function destinatarioMeta(crudo: string | null | undefined): string | null {
  const nacional = digitosNacionales(crudo);
  return nacional ? `52${nacional}` : null;
}

export const whatsAppRecipient = destinatarioMeta;

export function telefonoBarberoDesdeEntorno(slug: string): string | null {
  const crudo = process.env.WHATSAPP_BARBER_PHONES ?? "";
  for (const parte of crudo.split(",")) {
    const [clave, telefono] = parte.split(":").map((pieza) => pieza.trim());
    if (clave === slug && telefono) return telefono;
  }
  return null;
}

export function resolverTelefonoBarbero(slug: string, guardado: string | null | undefined) {
  return destinatarioMeta(guardado) ?? destinatarioMeta(telefonoBarberoDesdeEntorno(slug));
}
