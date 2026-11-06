const idiomaPlantilla = () => process.env.WHATSAPP_TEMPLATE_LANG ?? "es_MX";

export const WHATSAPP_TEMPLATES = {
  confirm: () => process.env.WHATSAPP_TEMPLATE_CONFIRM ?? "cita_confirmada",
  reminder: () => process.env.WHATSAPP_TEMPLATE_REMINDER ?? "cita_recordatorio",
  reschedule: () => process.env.WHATSAPP_TEMPLATE_RESCHEDULE ?? "cita_reagendada",
  cancel: () => process.env.WHATSAPP_TEMPLATE_CANCEL ?? "cita_cancelada",
  barber: () => process.env.WHATSAPP_TEMPLATE_BARBER ?? "aviso_barbero",
};

const ENLACE_CITA = "https://el-calentano.vercel.app/cita";
const DIRECCION = "C. Miguel Hidalgo 4A, Metepec";

const EJEMPLO_CITA = ["Miguel", "Viernes 31 de octubre", "4:00 p.m.", "Corte de cabello", "Alex Ibarra", "3ERRVC"];

/**
 * Textos UTILITY (es_MX) que se registran en Meta. El orden de {{n}} es fijo
 * y Meta rechaza plantillas que empiezan o terminan con una variable.
 */
export const TEXTOS_PLANTILLAS: Array<{ nombre: string; texto: string; ejemplo: string[] }> = [
  {
    nombre: "cita_confirmada",
    texto: [
      "¡Hola, {{1}}! 👋",
      "",
      "Tu cita en *Barber Shop EL CALENTANO* ha quedado agendada. 💈",
      "",
      "📅 *Fecha:* {{2}}",
      "🕓 *Hora:* {{3}}",
      "✂️ *Servicio:* _{{4}}_",
      "👤 *Barbero:* {{5}}",
      "🎫 *Reserva:* `{{6}}`",
      `📍 *Dirección:* ${DIRECCION}`,
      "",
      `Puedes consultar los detalles en: ${ENLACE_CITA}`,
      "",
      "_El pago se realiza en el local._",
      "",
      "¡Te esperamos! ✨",
    ].join("\n"),
    ejemplo: EJEMPLO_CITA,
  },
  {
    nombre: "cita_recordatorio",
    texto: [
      "¡Hola, {{1}}! 👋",
      "",
      "Te recordamos que *mañana* tienes cita en *Barber Shop EL CALENTANO*. 💈",
      "",
      "📅 *Fecha:* {{2}}",
      "🕓 *Hora:* {{3}}",
      "✂️ *Servicio:* _{{4}}_",
      "👤 *Barbero:* {{5}}",
      "🎫 *Reserva:* `{{6}}`",
      `📍 *Dirección:* ${DIRECCION}`,
      "",
      `Si necesitas cambiarla, entra a: ${ENLACE_CITA}`,
      "",
      "_El pago se realiza en el local._",
      "",
      "¡Te esperamos! ✨",
    ].join("\n"),
    ejemplo: EJEMPLO_CITA,
  },
  {
    nombre: "cita_reagendada",
    texto: [
      "¡Hola, {{1}}! 👋",
      "",
      "Tu cita en *Barber Shop EL CALENTANO* cambió. 🔄 Estos son los nuevos datos:",
      "",
      "📅 *Fecha:* {{2}}",
      "🕓 *Hora:* {{3}}",
      "✂️ *Servicio:* _{{4}}_",
      "👤 *Barbero:* {{5}}",
      "🎫 *Reserva:* `{{6}}`",
      "",
      `Puedes consultar los detalles en: ${ENLACE_CITA}`,
      "",
      "_El pago se realiza en el local._",
      "",
      "¡Te esperamos! ✨",
    ].join("\n"),
    ejemplo: ["Miguel", "Sábado 1 de noviembre", "11:00 a.m.", "Corte de cabello", "Alex Ibarra", "3ERRVC"],
  },
  {
    nombre: "cita_cancelada",
    texto: [
      "¡Hola, {{1}}! 👋",
      "",
      "Tu cita en *Barber Shop EL CALENTANO* ha sido cancelada. ❌",
      "",
      "📅 *Fecha:* {{2}}",
      "🕓 *Hora:* {{3}}",
      "✂️ *Servicio:* _{{4}}_",
      "👤 *Barbero:* {{5}}",
      "",
      "💳 *Cargo:* {{6}}",
      "",
      "Cuando quieras, agenda de nuevo en: https://el-calentano.vercel.app",
      "",
      "¡Gracias por avisarnos! ✨",
    ].join("\n"),
    ejemplo: ["Miguel", "Viernes 31 de octubre", "4:00 p.m.", "Corte de cabello", "Alex Ibarra", "Sin cargo."],
  },
  {
    nombre: "aviso_barbero",
    texto: [
      "*🔔 NUEVO MOVIMIENTO DE AGENDA*",
      "",
      "Se ha registrado un nuevo evento en *Barber Shop EL CALENTANO*.",
      "",
      "📌 *Movimiento:* {{1}}",
      "👤 *Cliente:* {{2}}",
      "✂️ *Servicio:* {{3}}",
      "💈 *Barbero:* {{4}}",
      "🕓 *Horario:* {{5}} a las {{6}}",
      "🎫 *Reserva:* `{{7}}`",
      "",
      "_Revisa los detalles completos en el panel del staff._",
    ].join("\n"),
    ejemplo: ["Cita nueva", "Miguel", "Corte de cabello", "Alex Ibarra", "Viernes 31 de octubre", "4:00 p.m.", "3ERRVC"],
  },
];

export type DatosCitaAviso = {
  nombreCliente: string;
  nombreServicio: string;
  nombreBarbero: string;
  inicio: Date;
  zonaHoraria: string;
  codigoPublico: string | null;
  cargoMxn?: number;
  cargoPorcentaje?: number;
};

export type PayloadPlantilla = {
  messaging_product: "whatsapp";
  type: "template";
  template: {
    name: string;
    language: { code: string };
    components: Array<{
      type: "body";
      parameters: Array<{ type: "text"; text: string }>;
    }>;
  };
};

export function templateParam(valor: string): string {
  const limpio = valor.replace(/[\r\n\t]+/g, " ").replace(/ {2,}/g, " ").trim();
  return limpio.slice(0, 200) || "-";
}

export function formatearFechaVisita(fecha: Date, zonaHoraria: string) {
  const texto = new Intl.DateTimeFormat("es-MX", {
    timeZone: zonaHoraria,
    weekday: "long",
    day: "numeric",
    month: "long",
  })
    .format(fecha)
    .replace(",", "");
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

export function formatearHoraVisita(fecha: Date, zonaHoraria: string) {
  return new Intl.DateTimeFormat("es-MX", {
    timeZone: zonaHoraria,
    hour: "numeric",
    minute: "2-digit",
  }).format(fecha);
}

export function textoCargo(cargoMxn?: number, cargoPorcentaje?: number) {
  if (!cargoMxn || cargoMxn <= 0) return "Sin cargo.";
  const porcentaje = cargoPorcentaje && cargoPorcentaje > 0 ? ` (${Math.round(cargoPorcentaje)}%)` : "";
  return `$${Math.round(cargoMxn)} MXN${porcentaje}, se cobra en el local.`;
}

export function parametrosCita(datos: DatosCitaAviso): string[] {
  return [
    templateParam(datos.nombreCliente),
    templateParam(formatearFechaVisita(datos.inicio, datos.zonaHoraria)),
    templateParam(formatearHoraVisita(datos.inicio, datos.zonaHoraria)),
    templateParam(datos.nombreServicio),
    templateParam(datos.nombreBarbero),
    templateParam(datos.codigoPublico ?? "-"),
  ];
}

export function parametrosCancelacion(datos: DatosCitaAviso): string[] {
  return [
    templateParam(datos.nombreCliente),
    templateParam(formatearFechaVisita(datos.inicio, datos.zonaHoraria)),
    templateParam(formatearHoraVisita(datos.inicio, datos.zonaHoraria)),
    templateParam(datos.nombreServicio),
    templateParam(datos.nombreBarbero),
    templateParam(textoCargo(datos.cargoMxn, datos.cargoPorcentaje)),
  ];
}

export function payloadPlantilla(nombre: string, parametros: string[], idioma = idiomaPlantilla()): PayloadPlantilla {
  return {
    messaging_product: "whatsapp",
    type: "template",
    template: {
      name: nombre,
      language: { code: idioma },
      components: [
        {
          type: "body",
          parameters: parametros.map((texto) => ({ type: "text" as const, text: texto })),
        },
      ],
    },
  };
}

export function plantillaConfirmacion(datos: DatosCitaAviso): PayloadPlantilla {
  return payloadPlantilla(WHATSAPP_TEMPLATES.confirm(), parametrosCita(datos));
}

export function plantillaRecordatorio(datos: DatosCitaAviso): PayloadPlantilla {
  return payloadPlantilla(WHATSAPP_TEMPLATES.reminder(), parametrosCita(datos));
}

export function plantillaCambio(datos: DatosCitaAviso): PayloadPlantilla {
  return payloadPlantilla(WHATSAPP_TEMPLATES.reschedule(), parametrosCita(datos));
}

export function plantillaCancelacion(datos: DatosCitaAviso): PayloadPlantilla {
  return payloadPlantilla(WHATSAPP_TEMPLATES.cancel(), parametrosCancelacion(datos));
}

export function plantillaBarbero(entrada: {
  encabezado: string;
  nombreCliente: string;
  nombreServicio: string;
  nombreBarbero: string;
  inicio: Date;
  zonaHoraria: string;
  codigoPublico: string | null;
}): PayloadPlantilla {
  return payloadPlantilla(WHATSAPP_TEMPLATES.barber(), [
    templateParam(entrada.encabezado),
    templateParam(entrada.nombreCliente),
    templateParam(entrada.nombreServicio),
    templateParam(entrada.nombreBarbero),
    templateParam(formatearFechaVisita(entrada.inicio, entrada.zonaHoraria)),
    templateParam(formatearHoraVisita(entrada.inicio, entrada.zonaHoraria)),
    templateParam(entrada.codigoPublico ?? "-"),
  ]);
}

export type TipoAvisoCliente = "CONFIRMATION" | "REMINDER" | "RESCHEDULE" | "CANCEL";

export function clientTemplate(
  tipo: TipoAvisoCliente,
  entrada: {
    clientName: string;
    serviceName: string;
    barberName: string;
    startAt: Date;
    timeZone: string;
    publicCode: string | null;
    feeMxn?: number;
    feePercent?: number;
  },
) {
  const datos: DatosCitaAviso = {
    nombreCliente: entrada.clientName,
    nombreServicio: entrada.serviceName,
    nombreBarbero: entrada.barberName,
    inicio: entrada.startAt,
    zonaHoraria: entrada.timeZone,
    codigoPublico: entrada.publicCode,
    cargoMxn: entrada.feeMxn,
    cargoPorcentaje: entrada.feePercent,
  };
  const payload =
    tipo === "CANCEL"
      ? plantillaCancelacion(datos)
      : tipo === "REMINDER"
        ? plantillaRecordatorio(datos)
        : tipo === "RESCHEDULE"
          ? plantillaCambio(datos)
          : plantillaConfirmacion(datos);
  return {
    template: payload.template.name,
    language: payload.template.language.code,
    parameters: payload.template.components[0].parameters.map((parametro) => parametro.text),
  };
}

export function barberTemplate(entrada: {
  headline: string;
  clientName: string;
  serviceName: string;
  barberName: string;
  startAt: Date;
  timeZone: string;
  publicCode: string | null;
}) {
  const payload = plantillaBarbero({
    encabezado: entrada.headline,
    nombreCliente: entrada.clientName,
    nombreServicio: entrada.serviceName,
    nombreBarbero: entrada.barberName,
    inicio: entrada.startAt,
    zonaHoraria: entrada.timeZone,
    codigoPublico: entrada.publicCode,
  });
  return {
    template: payload.template.name,
    language: payload.template.language.code,
    parameters: payload.template.components[0].parameters.map((parametro) => parametro.text),
  };
}

export function templateBody(nombre: string, parametros: string[]) {
  return JSON.stringify(payloadPlantilla(nombre, parametros));
}

export const formatVisitDate = formatearFechaVisita;
export const formatVisitTime = formatearHoraVisita;
