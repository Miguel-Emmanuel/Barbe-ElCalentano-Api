import { barberTemplate, clientTemplate, resolverTelefonoBarbero, type TipoAvisoCliente } from "../domain/whatsapp/index.js";
import { prisma } from "../lib/prisma.js";
import { sendTemplate } from "./whatsappService.js";

type Visita = {
  id: string;
  startAt: Date;
  publicCode: string | null;
  client: { id?: string; name: string; phone: string };
  barber: { name: string; slug: string; phone: string | null };
  service: { name: string };
};

const HORAS_RECORDATORIO = 24;

const ENCABEZADO_BARBERO: Record<Exclude<TipoAvisoCliente, "REMINDER">, string> = {
  CONFIRMATION: "Nueva cita",
  RESCHEDULE: "Cita movida",
  CANCEL: "Cita cancelada",
};

function momentoRecordatorio(inicio: Date) {
  return new Date(inicio.getTime() - HORAS_RECORDATORIO * 60 * 60 * 1000);
}

async function entregar(entrada: {
  destino: string;
  plantilla: string;
  idioma: string;
  parametros: string[];
  citaId: string;
  clientId?: string | null;
}) {
  const resultado = await sendTemplate({
    destino: entrada.destino,
    nombrePlantilla: entrada.plantilla,
    idioma: entrada.idioma,
    parametros: entrada.parametros,
    citaId: entrada.citaId,
    clientId: entrada.clientId,
  });
  if (resultado.status === "FAILED" || resultado.status === "FALLBACK_MOCK_NO_WHATSAPP_CREDENTIALS") {
    throw new Error(resultado.detail ?? resultado.status);
  }
  return resultado;
}

export async function notifyVisit(entrada: {
  kind: TipoAvisoCliente;
  visit: Visita;
  timeZone: string;
  feeMxn?: number;
  alertBarber?: boolean;
}) {
  const cliente = clientTemplate(entrada.kind, {
    clientName: entrada.visit.client.name,
    serviceName: entrada.visit.service.name,
    barberName: entrada.visit.barber.name,
    startAt: entrada.visit.startAt,
    timeZone: entrada.timeZone,
    publicCode: entrada.visit.publicCode,
    feeMxn: entrada.feeMxn,
  });

  await entregar({
    destino: entrada.visit.client.phone,
    plantilla: cliente.template,
    idioma: cliente.language,
    parametros: cliente.parameters,
    citaId: entrada.visit.id,
    clientId: entrada.visit.client.id,
  });

  if (!entrada.alertBarber || entrada.kind === "REMINDER") return;

  const destinoBarbero = resolverTelefonoBarbero(entrada.visit.barber.slug, entrada.visit.barber.phone);
  if (!destinoBarbero) {
    await prisma.notificationLog.create({
      data: {
        channel: "WHATSAPP",
        to: entrada.visit.barber.slug,
        body: "Sin WhatsApp de barbero",
        status: "SKIPPED_NO_BARBER_PHONE",
        meta: JSON.stringify({
          citaId: entrada.visit.id,
          tipo: entrada.kind,
          audiencia: "BARBER",
        }),
      },
    });
    return;
  }

  const staff = barberTemplate({
    headline: ENCABEZADO_BARBERO[entrada.kind],
    clientName: entrada.visit.client.name,
    serviceName: entrada.visit.service.name,
    startAt: entrada.visit.startAt,
    timeZone: entrada.timeZone,
    publicCode: entrada.visit.publicCode,
  });

  await entregar({
    destino: destinoBarbero,
    plantilla: staff.template,
    idioma: staff.language,
    parametros: staff.parameters,
    citaId: entrada.visit.id,
  });
}

async function programarRecordatorio(citaId: string, inicio: Date) {
  const correrEn = momentoRecordatorio(inicio);
  const pendiente = await prisma.reminderJob.findFirst({
    where: { appointmentId: citaId, status: "PENDING" },
  });

  if (correrEn.getTime() <= Date.now()) {
    if (pendiente) {
      await prisma.reminderJob.update({
        where: { id: pendiente.id },
        data: { status: "SKIPPED", channel: "WHATSAPP" },
      });
    }
    return;
  }

  if (pendiente) {
    await prisma.reminderJob.update({
      where: { id: pendiente.id },
      data: { runAt: correrEn, channel: "WHATSAPP" },
    });
    return;
  }

  await prisma.reminderJob.create({
    data: {
      appointmentId: citaId,
      runAt: correrEn,
      channel: "WHATSAPP",
      status: "PENDING",
    },
  });
}

export async function createAppointmentReminder(visita: Visita, zonaHoraria: string) {
  await programarRecordatorio(visita.id, visita.startAt);
  await notifyVisit({ kind: "CONFIRMATION", visit: visita, timeZone: zonaHoraria, alertBarber: true });
  return prisma.reminderJob.findFirst({
    where: { appointmentId: visita.id },
    orderBy: { createdAt: "desc" },
  });
}

export async function notifyAppointmentCancelled(visita: Visita, zonaHoraria: string, cargoMxn: number) {
  await prisma.reminderJob.updateMany({
    where: { appointmentId: visita.id, status: "PENDING" },
    data: { status: "SKIPPED" },
  });
  await notifyVisit({ kind: "CANCEL", visit: visita, timeZone: zonaHoraria, feeMxn: cargoMxn, alertBarber: true });
}

export async function notifyAppointmentRescheduled(visita: Visita, zonaHoraria: string) {
  await programarRecordatorio(visita.id, visita.startAt);
  await notifyVisit({ kind: "RESCHEDULE", visit: visita, timeZone: zonaHoraria, alertBarber: true });
}

export async function processDueReminders(limite = 20) {
  const vencidos = await prisma.reminderJob.findMany({
    where: { status: "PENDING", runAt: { lte: new Date() } },
    take: limite,
    orderBy: { runAt: "asc" },
  });

  const resultados = [];
  for (const trabajo of vencidos) {
    try {
      const cita = await prisma.appointment.findUnique({
        where: { id: trabajo.appointmentId },
        include: { client: true, service: true, barber: true, branch: true },
      });
      if (
        !cita ||
        ["CANCELLED", "NO_SHOW", "COMPLETED"].includes(cita.status) ||
        cita.startAt.getTime() <= Date.now()
      ) {
        await prisma.reminderJob.update({
          where: { id: trabajo.id },
          data: { status: "SKIPPED" },
        });
        continue;
      }

      await notifyVisit({
        kind: "REMINDER",
        visit: cita,
        timeZone: cita.branch.timezone,
        alertBarber: false,
      });

      resultados.push(
        await prisma.reminderJob.update({
          where: { id: trabajo.id },
          data: { status: "SENT", attempts: trabajo.attempts + 1 },
        }),
      );
    } catch (error) {
      await prisma.reminderJob.update({
        where: { id: trabajo.id },
        data: {
          attempts: trabajo.attempts + 1,
          lastError: error instanceof Error ? error.message : "error",
          status: trabajo.attempts + 1 >= 3 ? "FAILED" : "PENDING",
        },
      });
    }
  }
  return resultados;
}
