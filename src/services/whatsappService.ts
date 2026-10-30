import type { EventoYCloud, PayloadWebhook } from "../domain/whatsapp/payload.js";
import { digitosNacionales, destinatarioMeta, telefonoE164 } from "../domain/whatsapp/phone.js";
import { payloadPlantilla } from "../domain/whatsapp/templates.js";
import { canSendFreeText } from "../domain/whatsapp/window.js";
import { prisma } from "../lib/prisma.js";

const ESPERA_REINTENTO_MS = [400, 1200];

export type ResultadoEnvio = {
  status: string;
  detail?: string;
};

type Proveedor = "meta" | "ycloud";

type MensajeSaliente =
  | { type: "template"; template: ReturnType<typeof payloadPlantilla>["template"] }
  | { type: "text"; text: { body: string } };

export function whatsappActivo(): boolean {
  return (process.env.WHATSAPP_ENABLED ?? "false").trim().toLowerCase() === "true";
}

function proveedor(): Proveedor {
  return (process.env.WHATSAPP_PROVIDER ?? "meta").trim().toLowerCase() === "ycloud" ? "ycloud" : "meta";
}

function versionApi() {
  return process.env.WHATSAPP_API_VERSION ?? process.env.WHATSAPP_GRAPH_VERSION ?? "v21.0";
}

function esperar(ms: number) {
  return new Promise((resolver) => setTimeout(resolver, ms));
}

function sePuedeReintentar(estadoHttp: number) {
  return estadoHttp === 429 || estadoHttp >= 500;
}

async function registrar(entrada: {
  destino: string;
  cuerpo: string;
  estado: string;
  citaId?: string | null;
  clientId?: string | null;
  plantilla?: string | null;
  metaMessageId?: string | null;
  detalle?: string | null;
  direccion?: "INBOUND" | "OUTBOUND";
  meta?: Record<string, unknown>;
}) {
  const direccion = entrada.direccion ?? "OUTBOUND";
  try {
    await prisma.whatsappMessage.create({
      data: {
        citaId: entrada.citaId ?? null,
        clientId: entrada.clientId ?? null,
        direction: direccion,
        templateName: entrada.plantilla ?? null,
        body: entrada.cuerpo,
        status: entrada.estado,
        metaMessageId: entrada.metaMessageId ?? null,
        errorDetail: entrada.detalle ?? null,
      },
    });
  } catch (error) {
    console.error("whatsapp registro", error instanceof Error ? error.message : error);
  }

  if (direccion !== "OUTBOUND") return;
  try {
    await prisma.notificationLog.create({
      data: {
        channel: "WHATSAPP",
        to: entrada.destino,
        body: entrada.cuerpo,
        status: entrada.estado,
        meta: JSON.stringify({
          plantilla: entrada.plantilla ?? null,
          detalle: entrada.detalle ?? null,
          citaId: entrada.citaId ?? null,
          proveedor: proveedor(),
          ...(entrada.meta ?? {}),
        }),
      },
    });
  } catch (error) {
    console.error("whatsapp bitacora", error instanceof Error ? error.message : error);
  }
}

async function postConReintentos(
  url: string,
  encabezados: Record<string, string>,
  cuerpo: unknown,
  leerId: (json: Record<string, unknown> | null) => string | undefined,
  leerError: (json: Record<string, unknown> | null) => string | undefined,
): Promise<ResultadoEnvio> {
  let ultimoDetalle = "error";

  for (let intento = 0; intento < 3; intento += 1) {
    try {
      const respuesta = await fetch(url, {
        method: "POST",
        headers: { ...encabezados, "Content-Type": "application/json" },
        body: JSON.stringify(cuerpo),
      });
      const json = (await respuesta.json().catch(() => null)) as Record<string, unknown> | null;

      if (respuesta.ok) {
        return { status: "SENT", detail: leerId(json) };
      }

      ultimoDetalle = leerError(json) ?? `HTTP ${respuesta.status}`;
      if (!sePuedeReintentar(respuesta.status) || intento === 2) {
        return { status: "FAILED", detail: ultimoDetalle };
      }
    } catch (error) {
      ultimoDetalle = error instanceof Error ? error.message : "error de red";
      if (intento === 2) return { status: "FAILED", detail: ultimoDetalle };
    }

    await esperar(ESPERA_REINTENTO_MS[intento] ?? 1200);
  }

  return { status: "FAILED", detail: ultimoDetalle };
}

async function enviarMeta(destino: string, mensaje: MensajeSaliente): Promise<ResultadoEnvio> {
  const token = process.env.WHATSAPP_TOKEN;
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  if (!token || !phoneNumberId) {
    return { status: "FALLBACK_MOCK_NO_WHATSAPP_CREDENTIALS" };
  }
  const para = destinatarioMeta(destino);
  return postConReintentos(
    `https://graph.facebook.com/${versionApi()}/${phoneNumberId}/messages`,
    { Authorization: `Bearer ${token}` },
    { messaging_product: "whatsapp", to: para, ...mensaje },
    (json) => (json?.messages as Array<{ id?: string }> | undefined)?.[0]?.id,
    (json) => (json?.error as { message?: string } | undefined)?.message,
  );
}

async function enviarYCloud(destino: string, mensaje: MensajeSaliente): Promise<ResultadoEnvio> {
  const llave = process.env.YCLOUD_API_KEY;
  const desde = telefonoE164(process.env.YCLOUD_FROM);
  if (!llave || !desde) {
    return { status: "FALLBACK_MOCK_NO_WHATSAPP_CREDENTIALS" };
  }
  return postConReintentos(
    "https://api.ycloud.com/v2/whatsapp/messages/sendDirectly",
    { "X-API-Key": llave },
    { from: desde, to: telefonoE164(destino), ...mensaje },
    (json) => (typeof json?.id === "string" ? json.id : undefined),
    (json) => {
      const error = json?.error as { message?: string } | undefined;
      if (error?.message) return error.message;
      return typeof json?.message === "string" ? json.message : undefined;
    },
  );
}

function enviar(destino: string, mensaje: MensajeSaliente) {
  return proveedor() === "ycloud" ? enviarYCloud(destino, mensaje) : enviarMeta(destino, mensaje);
}

export async function sendTemplate(entrada: {
  destino: string;
  nombrePlantilla: string;
  idioma: string;
  parametros: string[];
  citaId?: string | null;
  clientId?: string | null;
}): Promise<ResultadoEnvio> {
  const destino = destinatarioMeta(entrada.destino);
  const vista = entrada.parametros.join(" · ");
  if (!destino) {
    await registrar({
      destino: entrada.destino,
      cuerpo: vista,
      estado: "SKIPPED_BAD_PHONE",
      citaId: entrada.citaId,
      clientId: entrada.clientId,
      plantilla: entrada.nombrePlantilla,
    });
    return { status: "SKIPPED_BAD_PHONE" };
  }

  if (!whatsappActivo()) {
    await registrar({
      destino,
      cuerpo: vista,
      estado: "SENT_MOCK",
      citaId: entrada.citaId,
      clientId: entrada.clientId,
      plantilla: entrada.nombrePlantilla,
    });
    return { status: "SENT_MOCK" };
  }

  const { template } = payloadPlantilla(entrada.nombrePlantilla, entrada.parametros, entrada.idioma);
  const resultado = await enviar(destino, { type: "template", template });
  await registrar({
    destino,
    cuerpo: vista,
    estado: resultado.status,
    citaId: entrada.citaId,
    clientId: entrada.clientId,
    plantilla: entrada.nombrePlantilla,
    metaMessageId: resultado.status === "SENT" ? resultado.detail : null,
    detalle: resultado.detail,
  });
  return resultado;
}

function filtroTelefono(nacional: string) {
  return { OR: [{ phone: nacional }, { phone: `52${nacional}` }, { phone: `+52${nacional}` }] };
}

async function ultimoEntranteDe(destino: string, clientId?: string | null) {
  if (clientId) {
    const cliente = await prisma.client.findUnique({
      where: { id: clientId },
      select: { lastInboundAt: true },
    });
    return cliente?.lastInboundAt ?? null;
  }
  const nacional = digitosNacionales(destino);
  if (!nacional) return null;
  const cliente = await prisma.client.findFirst({
    where: filtroTelefono(nacional),
    select: { lastInboundAt: true },
  });
  return cliente?.lastInboundAt ?? null;
}

export async function sendText(entrada: {
  destino: string;
  texto: string;
  citaId?: string | null;
  clientId?: string | null;
  ultimoEntrante?: Date | null;
}): Promise<ResultadoEnvio> {
  const destino = destinatarioMeta(entrada.destino);
  if (!destino) {
    await registrar({
      destino: entrada.destino,
      cuerpo: entrada.texto,
      estado: "SKIPPED_BAD_PHONE",
      citaId: entrada.citaId,
      clientId: entrada.clientId,
    });
    return { status: "SKIPPED_BAD_PHONE" };
  }

  const ultimo =
    entrada.ultimoEntrante === undefined
      ? await ultimoEntranteDe(destino, entrada.clientId)
      : entrada.ultimoEntrante;
  if (!canSendFreeText(ultimo)) {
    await registrar({
      destino,
      cuerpo: entrada.texto,
      estado: "VENTANA_CERRADA",
      citaId: entrada.citaId,
      clientId: entrada.clientId,
      detalle: "Fuera de las 24h. Solo plantilla.",
    });
    return { status: "VENTANA_CERRADA", detail: "Fuera de las 24h. Solo plantilla." };
  }

  if (!whatsappActivo()) {
    await registrar({
      destino,
      cuerpo: entrada.texto,
      estado: "SENT_MOCK",
      citaId: entrada.citaId,
      clientId: entrada.clientId,
    });
    return { status: "SENT_MOCK" };
  }

  const resultado = await enviar(destino, {
    type: "text",
    text: { body: entrada.texto },
  });
  await registrar({
    destino,
    cuerpo: entrada.texto,
    estado: resultado.status,
    citaId: entrada.citaId,
    clientId: entrada.clientId,
    metaMessageId: resultado.status === "SENT" ? resultado.detail : null,
    detalle: resultado.detail,
  });
  return resultado;
}

async function guardarEntrante(entrada: {
  idMensaje: string;
  desde: string;
  momento: Date;
  tipo: string;
  texto?: string;
}) {
  const yaExiste = await prisma.whatsappMessage.findFirst({
    where: { metaMessageId: entrada.idMensaje, direction: "INBOUND" },
    select: { id: true },
  });
  if (yaExiste) return;

  const nacional = digitosNacionales(entrada.desde);
  const cliente = nacional
    ? await prisma.client.findFirst({
        where: filtroTelefono(nacional),
        select: { id: true, lastInboundAt: true },
      })
    : null;

  const momento = Number.isNaN(entrada.momento.getTime()) ? new Date() : entrada.momento;
  if (cliente && (!cliente.lastInboundAt || cliente.lastInboundAt < momento)) {
    await prisma.client.update({
      where: { id: cliente.id },
      data: { lastInboundAt: momento },
    });
  }

  await registrar({
    destino: entrada.desde,
    cuerpo: entrada.texto?.trim() || `[${entrada.tipo}]`,
    estado: "RECEIVED",
    clientId: cliente?.id ?? null,
    metaMessageId: entrada.idMensaje,
    direccion: "INBOUND",
  });
}

const ESTADOS: Record<string, string> = {
  accepted: "SENT",
  sent: "SENT",
  delivered: "DELIVERED",
  read: "READ",
  failed: "FAILED",
};

async function aplicarEstado(ids: string[], estado: string, detalle: string | null) {
  const validos = ids.filter(Boolean);
  if (validos.length === 0) return;
  await prisma.whatsappMessage.updateMany({
    where: { metaMessageId: { in: validos }, direction: "OUTBOUND" },
    data: {
      status: ESTADOS[estado.toLowerCase()] ?? estado.toUpperCase(),
      errorDetail: detalle,
    },
  });
}

export async function handleInbound(payload: PayloadWebhook) {
  const wabaEsperado = process.env.WHATSAPP_WABA_ID?.trim();
  for (const entrada of payload.entry) {
    if (wabaEsperado && entrada.id !== wabaEsperado) continue;
    for (const cambio of entrada.changes) {
      if (cambio.field !== "messages") continue;
      for (const mensaje of cambio.value.messages ?? []) {
        await guardarEntrante({
          idMensaje: mensaje.id,
          desde: mensaje.from,
          momento: new Date(Number(mensaje.timestamp) * 1000),
          tipo: mensaje.type,
          texto: mensaje.text?.body,
        });
      }
      for (const estado of cambio.value.statuses ?? []) {
        const detalle = estado.errors?.[0]?.message ?? estado.errors?.[0]?.title ?? null;
        await aplicarEstado([estado.id], estado.status, detalle);
      }
    }
  }
}

export async function handleYCloudEvent(evento: EventoYCloud) {
  if (evento.type === "whatsapp.inbound_message.received" && evento.whatsappInboundMessage) {
    const mensaje = evento.whatsappInboundMessage;
    await guardarEntrante({
      idMensaje: mensaje.wamid ?? mensaje.id,
      desde: mensaje.from,
      momento: new Date(mensaje.sendTime ?? evento.createTime ?? Date.now()),
      tipo: mensaje.type,
      texto: mensaje.text?.body,
    });
    return;
  }

  if (evento.type === "whatsapp.message.updated" && evento.whatsappMessage) {
    const mensaje = evento.whatsappMessage;
    await aplicarEstado(
      [mensaje.id, mensaje.wamid ?? ""],
      mensaje.status,
      mensaje.errorMessage ?? null,
    );
  }
}
