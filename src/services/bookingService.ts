import { AppointmentStatus } from "@prisma/client";
import {
  addMinutes,
  assertNoOverlap,
  dayOfWeekInTz,
  effectiveDurationMin,
  effectivePriceCents,
  findAvailableSlots,
  isWithinBusinessHours,
  startOfLocalDay,
} from "../domain/availability.js";
import {
  canMarkPaid,
  assertStatusTransition,
  type AppointmentStatus as DomainStatus,
} from "../domain/appointmentStatus.js";
import {
  cancellationFeeCents,
  depositAmountCents,
  loyaltyPointsEarned,
  splitEarnings,
} from "../domain/moneyRules.js";
import { availabilityCache } from "../lib/cache.js";
import { AppError } from "../lib/errors.js";
import { prisma } from "../lib/prisma.js";
import { createAppointmentReminder } from "./notifyService.js";
import { assertValidTip, createDepositIntent } from "./paymentsService.js";

const BUFFER = Number(process.env.BUFFER_MINUTES ?? 5);
const SLOT_STEP = Number(process.env.SLOT_STEP_MINUTES ?? 10);

function cacheKey(input: { date: string; serviceId: string; barberId: string; quantity: number }) {
  return `avail:${input.date}:${input.barberId}:${input.serviceId}:${input.quantity}`;
}

export async function listServices() {
  return prisma.service.findMany({
    where: { active: true },
    orderBy: { sortOrder: "asc" },
  });
}

export async function listBarbers() {
  return prisma.barber.findMany({
    where: { active: true },
    orderBy: { name: "asc" },
  });
}

export async function getBranch() {
  const branch = await prisma.branch.findFirst({
    include: { businessHours: { orderBy: { dayOfWeek: "asc" } } },
  });
  if (!branch) throw new AppError("NOT_FOUND", "Sucursal no configurada.", 404);
  return branch;
}

export async function getAvailability(input: {
  date: string;
  serviceId: string;
  barberId: string;
  quantity?: number;
}) {
  const quantity = input.quantity ?? 1;
  const key = cacheKey({ ...input, quantity });
  const cached = availabilityCache.get(key);
  if (cached) return cached as Awaited<ReturnType<typeof computeAvailability>>;

  const result = await computeAvailability({ ...input, quantity });
  availabilityCache.set(key, result);
  return result;
}

async function computeAvailability(input: {
  date: string;
  serviceId: string;
  barberId: string;
  quantity: number;
}) {
  const service = await prisma.service.findUnique({ where: { id: input.serviceId } });
  if (!service || !service.active) {
    throw new AppError("SERVICE_INACTIVE", "Ese servicio no está disponible por ahora.");
  }

  const barber = await prisma.barber.findUnique({ where: { id: input.barberId } });
  if (!barber || !barber.active) {
    throw new AppError("BARBER_UNAVAILABLE", "Ese barbero no está disponible.");
  }

  const branch = await getBranch();
  const dayStart = startOfLocalDay(input.date, branch.timezone);
  const dow = dayOfWeekInTz(new Date(dayStart.getTime() + 12 * 3600_000), branch.timezone);
  const window = branch.businessHours.find((h) => h.dayOfWeek === dow);

  if (!window || window.closed) {
    return {
      date: input.date,
      barberId: barber.id,
      serviceId: service.id,
      slots: [] as string[],
      note: "Cerrado ese día.",
      byAppointmentOnly: false,
      policies: {
        cancelNoticeHours: branch.cancelNoticeHours,
        lateCancelFeePercent: branch.lateCancelFeePercent,
        graceMinutes: branch.graceMinutes,
      },
    };
  }

  const durationMin = effectiveDurationMin(service.durationMin, input.quantity);
  const dayEnd = addMinutes(dayStart, 24 * 60);

  const existing = await prisma.appointment.findMany({
    where: {
      barberId: barber.id,
      status: { notIn: [AppointmentStatus.CANCELLED, AppointmentStatus.NO_SHOW] },
      startAt: { lt: dayEnd },
      endAt: { gt: dayStart },
    },
    select: { startAt: true, endAt: true },
    orderBy: { startAt: "asc" },
  });

  const slots = findAvailableSlots({
    dayStart,
    openMin: window.openMin,
    closeMin: window.closeMin,
    durationMin,
    bufferMin: BUFFER,
    slotStepMin: SLOT_STEP,
    existing,
  });

  return {
    date: input.date,
    barberId: barber.id,
    serviceId: service.id,
    durationMin,
    slotStepMin: SLOT_STEP,
    bufferMin: BUFFER,
    currency: "MXN",
    byAppointmentOnly: window.byAppointmentOnly,
    note: window.byAppointmentOnly
      ? "Domingo solo por cita (11:00–16:00)."
      : undefined,
    slots: slots.map((d) => d.toISOString()),
    policies: {
      cancelNoticeHours: branch.cancelNoticeHours,
      lateCancelFeePercent: branch.lateCancelFeePercent,
      graceMinutes: branch.graceMinutes,
      paymentNote: "El pago se realiza en el local (MXN).",
    },
  };
}

export async function createAppointment(input: {
  serviceId: string;
  barberId: string;
  startAt: string;
  clientName: string;
  clientPhone: string;
  clientEmail?: string;
  quantity?: number;
  notes?: string;
}) {
  const quantity = input.quantity ?? 1;
  if (quantity < 1 || quantity > 2) {
    throw new AppError("VALIDATION_ERROR", "La cantidad debe ser 1 o 2.", 422);
  }

  const service = await prisma.service.findUnique({ where: { id: input.serviceId } });
  if (!service || !service.active) {
    throw new AppError("SERVICE_INACTIVE", "Ese servicio no está disponible por ahora.");
  }
  if (!service.allowsQuantity && quantity !== 1) {
    throw new AppError("VALIDATION_ERROR", "Este servicio no admite cantidad.", 422);
  }

  const barber = await prisma.barber.findUnique({ where: { id: input.barberId } });
  if (!barber || !barber.active) {
    throw new AppError("BARBER_UNAVAILABLE", "Ese barbero no está disponible.");
  }

  const branch = await getBranch();
  const startAt = new Date(input.startAt);
  if (Number.isNaN(startAt.getTime())) {
    throw new AppError("VALIDATION_ERROR", "Fecha u hora inválida.", 422);
  }
  if (startAt.getTime() <= Date.now()) {
    throw new AppError(
      "SLOT_IN_PAST",
      "No puedes reservar un horario que ya pasó. Elige otra hora.",
      422,
    );
  }

  const durationMin = effectiveDurationMin(service.durationMin, quantity);
  const endAt = addMinutes(startAt, durationMin);
  const dow = dayOfWeekInTz(startAt, branch.timezone);
  const window = branch.businessHours.find((h) => h.dayOfWeek === dow);

  if (
    !isWithinBusinessHours(
      startAt,
      endAt,
      window
        ? {
            dayOfWeek: window.dayOfWeek,
            openMin: window.openMin,
            closeMin: window.closeMin,
            closed: window.closed,
            byAppointmentOnly: window.byAppointmentOnly,
          }
        : undefined,
      branch.timezone,
    )
  ) {
    throw new AppError(
      "OUTSIDE_HOURS",
      dow === 0
        ? "Los domingos solo atendemos por cita de 11:00 a 16:00."
        : "Ese horario está fuera del horario de atención (lun–sáb).",
    );
  }

  let client = await prisma.client.findUnique({ where: { phone: input.clientPhone } });
  if (client?.blocked) {
    throw new AppError("CLIENT_BLOCKED", "No es posible agendar con este teléfono.");
  }
  if (!client) {
    client = await prisma.client.create({
      data: {
        name: input.clientName,
        phone: input.clientPhone,
        email: input.clientEmail,
      },
    });
  } else {
    client = await prisma.client.update({
      where: { id: client.id },
      data: {
        name: input.clientName,
        email: input.clientEmail ?? client.email,
      },
    });
  }

  const lookback = addMinutes(startAt, -24 * 60);
  const lookahead = addMinutes(startAt, 24 * 60);

  const existing = await prisma.appointment.findMany({
    where: {
      barberId: barber.id,
      status: { notIn: [AppointmentStatus.CANCELLED, AppointmentStatus.NO_SHOW] },
      startAt: { lt: lookahead },
      endAt: { gt: lookback },
    },
    select: { startAt: true, endAt: true },
  });

  if (!assertNoOverlap({ startAt, endAt }, existing, BUFFER)) {
    throw new AppError("SLOT_TAKEN", "Ese horario ya no está disponible. Elige otro.", 409);
  }

  const priceCents = effectivePriceCents(service.priceCents, quantity);
  const depositCents = branch.depositRequired
    ? depositAmountCents(priceCents, branch.depositPercent)
    : 0;

  try {
    const appointment = await prisma.appointment.create({
      data: {
        startAt,
        endAt,
        status: AppointmentStatus.SCHEDULED,
        quantity,
        priceCents,
        depositCents,
        notes: input.notes,
        clientId: client.id,
        barberId: barber.id,
        serviceId: service.id,
        branchId: branch.id,
        payment: {
          create: {
            amountCents: priceCents,
            tipCents: 0,
            method: "CASH",
            status: "PENDING",
          },
        },
      },
      include: {
        client: true,
        barber: true,
        service: true,
        payment: true,
      },
    });

    availabilityCache.invalidatePrefix("avail:");
    await createAppointmentReminder(appointment.id, startAt, client.phone);

    const deposit = await createDepositIntent({
      appointmentId: appointment.id,
      serviceCents: priceCents,
      depositPercent: branch.depositRequired ? branch.depositPercent : 0,
    });

    return {
      ...appointment,
      currency: "MXN",
      paymentNote: "El pago se realiza en el local.",
      policies: {
        cancelNoticeHours: branch.cancelNoticeHours,
        lateCancelFeePercent: branch.lateCancelFeePercent,
        message: `Cancela con al menos ${branch.cancelNoticeHours}h de anticipación o aplica cargo del ${branch.lateCancelFeePercent}%.`,
      },
      deposit,
    };
  } catch (e) {
    if (e instanceof AppError) throw e;
    throw new AppError("CONFLICT", "No se pudo guardar la cita. Intenta otro horario.", 409);
  }
}

export async function listAppointments(date?: string) {
  const where: { startAt?: { gte: Date; lt: Date } } = {};
  if (date) {
    const branch = await getBranch();
    const start = startOfLocalDay(date, branch.timezone);
    const end = addMinutes(start, 24 * 60);
    where.startAt = { gte: start, lt: end };
  }

  return prisma.appointment.findMany({
    where,
    include: {
      client: true,
      barber: true,
      service: true,
      payment: true,
      commission: true,
    },
    orderBy: { startAt: "asc" },
  });
}

export async function updateAppointmentStatus(id: string, status: AppointmentStatus) {
  const current = await prisma.appointment.findUnique({ where: { id } });
  if (!current) throw new AppError("NOT_FOUND", "Cita no encontrada.", 404);

  if (status === AppointmentStatus.CANCELLED) {
    return cancelAppointment(id);
  }

  if (status === AppointmentStatus.COMPLETED) {
    throw new AppError(
      "INVALID_STATUS_TRANSITION",
      "Para completar una cita debes usar Cobrar (después del check-in).",
      409,
    );
  }

  assertStatusTransition(
    current.status as DomainStatus,
    status as DomainStatus,
  );

  const updated = await prisma.appointment.update({
    where: { id },
    data: { status },
    include: { client: true, barber: true, service: true, payment: true, commission: true },
  });
  availabilityCache.invalidatePrefix("avail:");
  return updated;
}

export async function cancelAppointment(id: string) {
  const appt = await prisma.appointment.findUnique({
    where: { id },
    include: { branch: true, client: true, barber: true, service: true, payment: true },
  });
  if (!appt) throw new AppError("NOT_FOUND", "Cita no encontrada.", 404);

  assertStatusTransition(appt.status as DomainStatus, "CANCELLED");

  const cancelledAt = new Date();
  const fee = cancellationFeeCents({
    serviceCents: appt.priceCents,
    startAt: appt.startAt,
    cancelledAt,
    noticeHours: appt.branch.cancelNoticeHours,
    lateFeePercent: appt.branch.lateCancelFeePercent,
  });

  const updated = await prisma.appointment.update({
    where: { id },
    data: {
      status: AppointmentStatus.CANCELLED,
      cancelledAt,
      cancellationFeeCents: fee,
    },
    include: { client: true, barber: true, service: true, payment: true },
  });

  availabilityCache.invalidatePrefix("avail:");

  return {
    ...updated,
    currency: "MXN",
    cancellation: {
      feeCents: fee,
      feeMxn: fee / 100,
      late: fee > 0,
      message:
        fee > 0
          ? `Cancelación tardía: cargo de $${(fee / 100).toFixed(0)} MXN (${appt.branch.lateCancelFeePercent}%).`
          : "Cancelación a tiempo. Sin cargo.",
    },
  };
}

export async function rescheduleAppointment(id: string, startAtIso: string) {
  const appt = await prisma.appointment.findUnique({
    where: { id },
    include: { service: true, barber: true },
  });
  if (!appt) throw new AppError("NOT_FOUND", "Cita no encontrada.", 404);
  if (["CANCELLED", "COMPLETED", "NO_SHOW"].includes(appt.status)) {
    throw new AppError("INVALID_STATUS_TRANSITION", "No se puede reprogramar esta cita.", 409);
  }

  const startAt = new Date(startAtIso);
  if (Number.isNaN(startAt.getTime())) {
    throw new AppError("VALIDATION_ERROR", "Nueva hora inválida.", 422);
  }

  const durationMin = Math.round((appt.endAt.getTime() - appt.startAt.getTime()) / 60000);
  const endAt = addMinutes(startAt, durationMin);
  const branch = await getBranch();
  const dow = dayOfWeekInTz(startAt, branch.timezone);
  const window = branch.businessHours.find((h) => h.dayOfWeek === dow);

  if (
    !isWithinBusinessHours(
      startAt,
      endAt,
      window
        ? {
            dayOfWeek: window.dayOfWeek,
            openMin: window.openMin,
            closeMin: window.closeMin,
            closed: window.closed,
            byAppointmentOnly: window.byAppointmentOnly,
          }
        : undefined,
      branch.timezone,
    )
  ) {
    throw new AppError("OUTSIDE_HOURS", "El nuevo horario está fuera de atención.");
  }

  const lookback = addMinutes(startAt, -24 * 60);
  const lookahead = addMinutes(startAt, 24 * 60);
  const existing = await prisma.appointment.findMany({
    where: {
      barberId: appt.barberId,
      id: { not: appt.id },
      status: { notIn: [AppointmentStatus.CANCELLED, AppointmentStatus.NO_SHOW] },
      startAt: { lt: lookahead },
      endAt: { gt: lookback },
    },
    select: { startAt: true, endAt: true },
  });

  if (!assertNoOverlap({ startAt, endAt }, existing, BUFFER)) {
    throw new AppError("SLOT_TAKEN", "Ese horario ya no está disponible.", 409);
  }

  const updated = await prisma.appointment.update({
    where: { id },
    data: { startAt, endAt },
    include: { client: true, barber: true, service: true, payment: true },
  });
  availabilityCache.invalidatePrefix("avail:");
  return updated;
}

export async function markPaid(input: {
  appointmentId: string;
  method?: "CASH" | "CARD" | "TRANSFER" | "OTHER";
  tipCents?: number;
}) {
  const tipCents = input.tipCents ?? 0;
  assertValidTip(tipCents);

  const appt = await prisma.appointment.findUnique({
    where: { id: input.appointmentId },
    include: { payment: true, barber: true, branch: true, client: true },
  });
  if (!appt) throw new AppError("NOT_FOUND", "Cita no encontrada.", 404);
  if (!appt.payment) throw new AppError("NOT_FOUND", "Pago no encontrado.", 404);
  if (appt.payment.status === "PAID") {
    throw new AppError("CONFLICT", "Esta cita ya está cobrada.", 409);
  }
  if (!canMarkPaid(appt.status as DomainStatus)) {
    throw new AppError(
      "INVALID_STATUS_TRANSITION",
      "Primero haz check-in. Solo se puede cobrar una cita en estado Check-in.",
      409,
    );
  }

  const split = splitEarnings({
    serviceCents: appt.priceCents,
    tipCents,
    commissionPercent: appt.barber.commissionPercent,
  });

  const points = loyaltyPointsEarned(appt.priceCents, appt.branch.loyaltyPointsPer100Mxn);

  const [payment] = await prisma.$transaction([
    prisma.payment.update({
      where: { id: appt.payment.id },
      data: {
        status: "PAID",
        method: input.method ?? "CASH",
        tipCents,
        paidAt: new Date(),
      },
    }),
    prisma.appointment.update({
      where: { id: appt.id },
      data: { status: AppointmentStatus.COMPLETED },
    }),
    prisma.tip.upsert({
      where: { appointmentId: appt.id },
      create: {
        appointmentId: appt.id,
        barberId: appt.barberId,
        amountCents: tipCents,
      },
      update: { amountCents: tipCents },
    }),
    prisma.commission.upsert({
      where: { appointmentId: appt.id },
      create: {
        appointmentId: appt.id,
        barberId: appt.barberId,
        serviceCents: appt.priceCents,
        tipCents,
        barberEarnCents: split.barberEarnCents,
        shopEarnCents: split.shopEarnCents,
        commissionPercent: split.commissionPercent,
      },
      update: {
        tipCents,
        barberEarnCents: split.barberEarnCents,
        shopEarnCents: split.shopEarnCents,
        commissionPercent: split.commissionPercent,
      },
    }),
    ...(points > 0
      ? [
          prisma.client.update({
            where: { id: appt.clientId },
            data: { loyaltyPoints: { increment: points } },
          }),
        ]
      : []),
  ]);

  return {
    payment,
    earnings: {
      ...split,
      currency: "MXN",
      barberEarnMxn: split.barberEarnCents / 100,
      shopEarnMxn: split.shopEarnCents / 100,
    },
    loyalty: {
      pointsEarned: points,
      message:
        points > 0
          ? `Se sumaron ${points} punto(s) de fidelidad al cliente.`
          : "Sin puntos esta compra (menos de $100 MXN).",
    },
    message: "Pago registrado en local. Propina 100% al barbero.",
    currency: "MXN",
  };
}
