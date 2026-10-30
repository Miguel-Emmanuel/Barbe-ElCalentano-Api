const idiomaPlantilla = () => process.env.WHATSAPP_TEMPLATE_LANG ?? "es_MX";

export const WHATSAPP_TEMPLATES = {
  confirm: () => process.env.WHATSAPP_TEMPLATE_CONFIRM ?? "cita_confirmada",
  reminder: () => process.env.WHATSAPP_TEMPLATE_REMINDER ?? "cita_recordatorio",
  reschedule: () => process.env.WHATSAPP_TEMPLATE_RESCHEDULE ?? "cita_reagendada",
  cancel: () => process.env.WHATSAPP_TEMPLATE_CANCEL ?? "cita_cancelada",
  barber: () => process.env.WHATSAPP_TEMPLATE_BARBER ?? "aviso_barbero",
};

/**
 * Textos UTILITY (es_MX) que se registran en Meta. El orden de {{n}} es fijo
 * y Meta rechaza plantillas que empiezan o terminan con una variable.
 */
export const TEXTOS_PLANTILLAS: Array<{ nombre: string; texto: string; ejemplo: string[] }> = [
  {
    nombre: "cita_confirmada",
    texto:
      "Hola {{1}}. Tu cita en Barber Shop EL CALENTANO quedó agendada: {{2}} con {{3}}, el {{4}} a las {{5}}. Tu número de reserva es {{6}}. Puedes consultarla en el-calentano.vercel.app/cita. Pago en el local.",
    ejemplo: ["Miguel", "Corte de cabello", "Alex Ibarra", "viernes 31 de octubre", "4:00 p.m.", "3ERRVC"],
  },
  {
    nombre: "cita_recordatorio",
    texto:
      "Hola {{1}}. Te recordamos tu cita en EL CALENTANO mañana: {{2}} con {{3}}, el {{4}} a las {{5}}. Código {{6}}. Pago en el local.",
    ejemplo: ["Miguel", "Corte de cabello", "Alex Ibarra", "viernes 31 de octubre", "4:00 p.m.", "3ERRVC"],
  },
  {
    nombre: "cita_reagendada",
    texto:
      "Hola {{1}}. Tu cita en EL CALENTANO cambió: {{2}} con {{3}}, el {{4}} a las {{5}}. Código {{6}}. Entra a el-calentano.vercel.app/cita si quieres verla. Pago en el local.",
    ejemplo: ["Miguel", "Corte de cabello", "Alex Ibarra", "sábado 1 de noviembre", "11:00 a.m.", "3ERRVC"],
  },
  {
    nombre: "cita_cancelada",
    texto:
      "Hola {{1}}. Tu cita del {{2}} a las {{3}} ({{4}} con {{5}}) quedó cancelada. {{6}} Gracias por avisar a Barber Shop EL CALENTANO.",
    ejemplo: ["Miguel", "viernes 31 de octubre", "4:00 p.m.", "Corte de cabello", "Alex Ibarra", "Sin cargo."],
  },
  {
    nombre: "aviso_barbero",
    texto:
      "Hola, este es un aviso de la agenda de Barber Shop EL CALENTANO. Movimiento: {{1}}. Cliente: {{2}}. Servicio: {{3}}, el {{4}} a las {{5}}. Número de reserva {{6}}. Revisa los detalles en el panel del staff.",
    ejemplo: ["Nueva cita", "Miguel", "Corte de cabello", "viernes 31 de octubre", "4:00 p.m.", "3ERRVC"],
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
  return new Intl.DateTimeFormat("es-MX", {
    timeZone: zonaHoraria,
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(fecha);
}

export function formatearHoraVisita(fecha: Date, zonaHoraria: string) {
  return new Intl.DateTimeFormat("es-MX", {
    timeZone: zonaHoraria,
    hour: "numeric",
    minute: "2-digit",
  }).format(fecha);
}

export function parametrosCita(datos: DatosCitaAviso): string[] {
  return [
    templateParam(datos.nombreCliente),
    templateParam(datos.nombreServicio),
    templateParam(datos.nombreBarbero),
    templateParam(formatearFechaVisita(datos.inicio, datos.zonaHoraria)),
    templateParam(formatearHoraVisita(datos.inicio, datos.zonaHoraria)),
    templateParam(datos.codigoPublico ?? "-"),
  ];
}

export function parametrosCancelacion(datos: DatosCitaAviso): string[] {
  const cargo =
    datos.cargoMxn && datos.cargoMxn > 0
      ? `Hay un cargo de $${Math.round(datos.cargoMxn)} MXN que se cobra en el local.`
      : "Sin cargo.";
  return [
    templateParam(datos.nombreCliente),
    templateParam(formatearFechaVisita(datos.inicio, datos.zonaHoraria)),
    templateParam(formatearHoraVisita(datos.inicio, datos.zonaHoraria)),
    templateParam(datos.nombreServicio),
    templateParam(datos.nombreBarbero),
    templateParam(cargo),
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
  inicio: Date;
  zonaHoraria: string;
  codigoPublico: string | null;
}): PayloadPlantilla {
  return payloadPlantilla(WHATSAPP_TEMPLATES.barber(), [
    templateParam(entrada.encabezado),
    templateParam(entrada.nombreCliente),
    templateParam(entrada.nombreServicio),
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
  startAt: Date;
  timeZone: string;
  publicCode: string | null;
}) {
  const payload = plantillaBarbero({
    encabezado: entrada.headline,
    nombreCliente: entrada.clientName,
    nombreServicio: entrada.serviceName,
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
