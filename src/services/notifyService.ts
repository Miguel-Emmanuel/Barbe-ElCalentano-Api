import {
  barberTemplate,
  clientTemplate,
  resolveBarberPhone,
  type ClientNoticeKind,
} from "../domain/whatsapp.js";
import { prisma } from "../lib/prisma.js";
import { sendWhatsAppTemplate } from "./whatsappCloud.js";

type VisitParty = {
  id: string;
  startAt: Date;
  publicCode: string | null;
  client: { name: string; phone: string };
  barber: { name: string; slug: string; phone: string | null };
  service: { name: string };
};

const BARBER_HEADLINE: Record<Exclude<ClientNoticeKind, "REMINDER">, string> = {
  CONFIRMATION: "Nueva cita",
  RESCHEDULE: "Cita movida",
  CANCEL: "Cita cancelada",
};

async function logSend(input: {
  to: string;
  body: string;
  status: string;
  meta: Record<string, unknown>;
}) {
  await prisma.notificationLog.create({
    data: {
      channel: "WHATSAPP",
      to: input.to,
      body: input.body,
      status: input.status,
      meta: JSON.stringify(input.meta),
    },
  });
}

async function deliver(input: {
  to: string;
  template: string;
  language: string;
  parameters: string[];
  meta: Record<string, unknown>;
}) {
  const preview = input.parameters.join(" · ");
  try {
    const result = await sendWhatsAppTemplate(input);
    await logSend({
      to: input.to,
      body: preview,
      status: result.status,
      meta: { ...input.meta, template: input.template, detail: result.detail ?? null },
    });
  } catch (error) {
    await logSend({
      to: input.to,
      body: preview,
      status: "FAILED",
      meta: {
        ...input.meta,
        template: input.template,
        detail: error instanceof Error ? error.message : "error",
      },
    });
  }
}

export async function notifyVisit(input: {
  kind: ClientNoticeKind;
  visit: VisitParty;
  timeZone: string;
  feeMxn?: number;
  alertBarber?: boolean;
}) {
  const client = clientTemplate(input.kind, {
    clientName: input.visit.client.name,
    serviceName: input.visit.service.name,
    barberName: input.visit.barber.name,
    startAt: input.visit.startAt,
    timeZone: input.timeZone,
    publicCode: input.visit.publicCode,
    feeMxn: input.feeMxn,
  });

  await deliver({
    to: input.visit.client.phone,
    ...client,
    meta: { appointmentId: input.visit.id, type: input.kind, audience: "CLIENT" },
  });

  if (!input.alertBarber || input.kind === "REMINDER") return;

  const barberTo = resolveBarberPhone(input.visit.barber.slug, input.visit.barber.phone);
  if (!barberTo) {
    await logSend({
      to: input.visit.barber.slug,
      body: "Sin WhatsApp de barbero",
      status: "SKIPPED_NO_BARBER_PHONE",
      meta: { appointmentId: input.visit.id, type: input.kind, audience: "BARBER" },
    });
    return;
  }

  const staff = barberTemplate({
    headline: BARBER_HEADLINE[input.kind],
    clientName: input.visit.client.name,
    serviceName: input.visit.service.name,
    startAt: input.visit.startAt,
    timeZone: input.timeZone,
    publicCode: input.visit.publicCode,
  });

  await deliver({
    to: barberTo,
    ...staff,
    meta: { appointmentId: input.visit.id, type: input.kind, audience: "BARBER" },
  });
}

export async function createAppointmentReminder(visit: VisitParty, timeZone: string) {
  const twoHoursBefore = new Date(visit.startAt.getTime() - 2 * 60 * 60 * 1000);
  const runAt = twoHoursBefore < new Date() ? new Date() : twoHoursBefore;

  const job = await prisma.reminderJob.create({
    data: {
      appointmentId: visit.id,
      runAt,
      channel: "WHATSAPP",
      status: "PENDING",
    },
  });

  await notifyVisit({ kind: "CONFIRMATION", visit, timeZone, alertBarber: true });
  return job;
}

export async function notifyAppointmentCancelled(visit: VisitParty, timeZone: string, feeMxn: number) {
  await prisma.reminderJob.updateMany({
    where: { appointmentId: visit.id, status: "PENDING" },
    data: { status: "SKIPPED" },
  });
  await notifyVisit({ kind: "CANCEL", visit, timeZone, feeMxn, alertBarber: true });
}

export async function notifyAppointmentRescheduled(visit: VisitParty, timeZone: string) {
  const twoHoursBefore = new Date(visit.startAt.getTime() - 2 * 60 * 60 * 1000);
  const runAt = twoHoursBefore < new Date() ? new Date() : twoHoursBefore;
  await prisma.reminderJob.updateMany({
    where: { appointmentId: visit.id, status: "PENDING" },
    data: { runAt, channel: "WHATSAPP" },
  });
  await notifyVisit({ kind: "RESCHEDULE", visit, timeZone, alertBarber: true });
}

export async function processDueReminders(limit = 20) {
  const due = await prisma.reminderJob.findMany({
    where: { status: "PENDING", runAt: { lte: new Date() } },
    take: limit,
    orderBy: { runAt: "asc" },
  });

  const results = [];
  for (const job of due) {
    try {
      const appt = await prisma.appointment.findUnique({
        where: { id: job.appointmentId },
        include: { client: true, service: true, barber: true, branch: true },
      });
      if (
        !appt ||
        ["CANCELLED", "NO_SHOW", "COMPLETED"].includes(appt.status) ||
        appt.startAt.getTime() <= Date.now()
      ) {
        await prisma.reminderJob.update({
          where: { id: job.id },
          data: { status: "SKIPPED" },
        });
        continue;
      }

      await notifyVisit({
        kind: "REMINDER",
        visit: appt,
        timeZone: appt.branch.timezone,
        alertBarber: false,
      });

      results.push(
        await prisma.reminderJob.update({
          where: { id: job.id },
          data: { status: "SENT", attempts: job.attempts + 1 },
        }),
      );
    } catch (e) {
      await prisma.reminderJob.update({
        where: { id: job.id },
        data: {
          attempts: job.attempts + 1,
          lastError: e instanceof Error ? e.message : "error",
          status: job.attempts + 1 >= 3 ? "FAILED" : "PENDING",
        },
      });
    }
  }
  return results;
}
