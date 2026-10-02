const TEMPLATE_LANG = () => process.env.WHATSAPP_TEMPLATE_LANG ?? "es_MX";

export const WHATSAPP_TEMPLATES = {
  confirm: () => process.env.WHATSAPP_TEMPLATE_CONFIRM ?? "cita_confirmada",
  reminder: () => process.env.WHATSAPP_TEMPLATE_REMINDER ?? "cita_recordatorio",
  reschedule: () => process.env.WHATSAPP_TEMPLATE_RESCHEDULE ?? "cita_reagendada",
  cancel: () => process.env.WHATSAPP_TEMPLATE_CANCEL ?? "cita_cancelada",
  barber: () => process.env.WHATSAPP_TEMPLATE_BARBER ?? "aviso_barbero",
};

/**
 * Plantillas de utilidad (es_MX) para pegar en Meta.
 * Los {{n}} salen en este orden y ninguno puede ir vacío.
 *
 * cita_confirmada
 * Hola {{1}}. Tu cita en Barber Shop EL CALENTANO quedó agendada: {{2}} con {{3}}, el {{4}} a las {{5}}. Código {{6}}. Entra a el-calentano.vercel.app/cita con tu teléfono y ese código. Pago en el local.
 *
 * cita_recordatorio
 * Hola {{1}}. Te recordamos tu cita en EL CALENTANO: {{2}} con {{3}}, el {{4}} a las {{5}}. Código {{6}}. Pago en el local.
 *
 * cita_reagendada
 * Hola {{1}}. Tu cita en EL CALENTANO cambió: {{2}} con {{3}}, el {{4}} a las {{5}}. Código {{6}}. Entra a el-calentano.vercel.app/cita si quieres verla. Pago en el local.
 *
 * cita_cancelada
 * Hola {{1}}. Tu cita del {{2}} a las {{3}} ({{4}} con {{5}}) quedó cancelada. {{6}}
 *
 * aviso_barbero
 * {{1}}. {{2}} pide {{3}} el {{4}} a las {{5}}. Código {{6}}.
 */

export function whatsAppRecipient(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const digits = raw.replace(/\D/g, "");
  let national = digits;
  if (digits.length === 13 && digits.startsWith("521")) national = digits.slice(3);
  else if (digits.length === 12 && digits.startsWith("52")) national = digits.slice(2);
  if (!/^\d{10}$/.test(national)) return null;
  return `52${national}`;
}

export function templateParam(value: string): string {
  const clean = value.replace(/[\r\n\t]+/g, " ").replace(/ {2,}/g, " ").trim();
  return clean.slice(0, 200) || "-";
}

export function formatVisitDate(date: Date, timeZone: string) {
  return new Intl.DateTimeFormat("es-MX", {
    timeZone,
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(date);
}

export function formatVisitTime(date: Date, timeZone: string) {
  return new Intl.DateTimeFormat("es-MX", {
    timeZone,
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

export function barberPhoneFromEnv(slug: string): string | null {
  const raw = process.env.WHATSAPP_BARBER_PHONES ?? "";
  for (const part of raw.split(",")) {
    const [key, phone] = part.split(":").map((piece) => piece.trim());
    if (key === slug && phone) return phone;
  }
  return null;
}

export function resolveBarberPhone(slug: string, stored: string | null | undefined) {
  return whatsAppRecipient(stored) ?? whatsAppRecipient(barberPhoneFromEnv(slug));
}

export type ClientNoticeKind = "CONFIRMATION" | "REMINDER" | "RESCHEDULE" | "CANCEL";

export function clientTemplate(kind: ClientNoticeKind, input: {
  clientName: string;
  serviceName: string;
  barberName: string;
  startAt: Date;
  timeZone: string;
  publicCode: string | null;
  feeMxn?: number;
}) {
  const name = templateParam(input.clientName);
  const service = templateParam(input.serviceName);
  const barber = templateParam(input.barberName);
  const day = templateParam(formatVisitDate(input.startAt, input.timeZone));
  const hour = templateParam(formatVisitTime(input.startAt, input.timeZone));
  const code = templateParam(input.publicCode ?? "-");

  if (kind === "CANCEL") {
    const fee =
      input.feeMxn && input.feeMxn > 0
        ? `Hay un cargo de $${Math.round(input.feeMxn)} MXN que se cobra en el local.`
        : "Sin cargo.";
    return {
      template: WHATSAPP_TEMPLATES.cancel(),
      language: TEMPLATE_LANG(),
      parameters: [name, day, hour, service, barber, templateParam(fee)],
    };
  }

  const template =
    kind === "REMINDER"
      ? WHATSAPP_TEMPLATES.reminder()
      : kind === "RESCHEDULE"
        ? WHATSAPP_TEMPLATES.reschedule()
        : WHATSAPP_TEMPLATES.confirm();

  return {
    template,
    language: TEMPLATE_LANG(),
    parameters: [name, service, barber, day, hour, code],
  };
}

export function barberTemplate(input: {
  headline: string;
  clientName: string;
  serviceName: string;
  startAt: Date;
  timeZone: string;
  publicCode: string | null;
}) {
  return {
    template: WHATSAPP_TEMPLATES.barber(),
    language: TEMPLATE_LANG(),
    parameters: [
      templateParam(input.headline),
      templateParam(input.clientName),
      templateParam(input.serviceName),
      templateParam(formatVisitDate(input.startAt, input.timeZone)),
      templateParam(formatVisitTime(input.startAt, input.timeZone)),
      templateParam(input.publicCode ?? "-"),
    ],
  };
}

export function templateBody(template: string, parameters: string[]) {
  return JSON.stringify({
    messaging_product: "whatsapp",
    type: "template",
    template: {
      name: template,
      language: { code: TEMPLATE_LANG() },
      components: [
        {
          type: "body",
          parameters: parameters.map((text) => ({ type: "text", text })),
        },
      ],
    },
  });
}
