import { prisma } from "../lib/prisma.js";

const MODE = (process.env.NOTIFY_MODE ?? "mock").toLowerCase();

export async function sendNotification(input: {
  channel: "SMS" | "WHATSAPP" | "EMAIL";
  to: string;
  subject?: string;
  body: string;
  meta?: Record<string, unknown>;
}) {
  let status = "SENT_MOCK";
  let meta = JSON.stringify({ mode: MODE, ...(input.meta ?? {}) });

  if (MODE === "twilio") {
    const sid = process.env.TWILIO_ACCOUNT_SID;
    const token = process.env.TWILIO_AUTH_TOKEN;
    const from = process.env.TWILIO_FROM;
    if (!sid || !token || !from) {
      status = "FALLBACK_MOCK_NO_TWILIO_CREDENTIALS";
    } else {
      status = "QUEUED_TWILIO";
      meta = JSON.stringify({ mode: "twilio", from, to: input.to });
    }
  }

  return prisma.notificationLog.create({
    data: {
      channel: input.channel,
      to: input.to,
      subject: input.subject,
      body: input.body,
      status,
      meta,
    },
  });
}

export async function createAppointmentReminder(
  appointmentId: string,
  startAt: Date,
  phone: string,
) {
  const twoHoursBefore = new Date(startAt.getTime() - 2 * 60 * 60 * 1000);
  const runAt = twoHoursBefore < new Date() ? new Date() : twoHoursBefore;

  const job = await prisma.reminderJob.create({
    data: {
      appointmentId,
      runAt,
      channel: "SMS",
      status: "PENDING",
    },
  });

  await sendNotification({
    channel: "SMS",
    to: phone,
    subject: "Cita EL CALENTANO",
    body: "Tu cita en Barber Shop EL CALENTANO quedó agendada. Pago en el local (MXN).",
    meta: { appointmentId, type: "CONFIRMATION" },
  });

  return job;
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
        include: { client: true, service: true, barber: true },
      });
      if (!appt || ["CANCELLED", "NO_SHOW", "COMPLETED"].includes(appt.status)) {
        await prisma.reminderJob.update({
          where: { id: job.id },
          data: { status: "SKIPPED" },
        });
        continue;
      }

      await sendNotification({
        channel: job.channel === "WHATSAPP" ? "WHATSAPP" : "SMS",
        to: appt.client.phone,
        body: `Recordatorio: ${appt.service.name} con ${appt.barber.name} en EL CALENTANO.`,
        meta: { appointmentId: appt.id, type: "REMINDER" },
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
