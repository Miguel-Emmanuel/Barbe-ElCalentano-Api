import { AppointmentStatus, Prisma } from "@prisma/client";
import {
  addMinutes,
  assertNoOverlap,
  rangesOverlap,
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
    note: window.byAppointmentOnly ? "Este día es solo por cita." : undefined,
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
      "Ese horario está fuera del horario de atención (9:00 a 20:00).",
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

function localDayKey(date: Date, timeZone: string) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function formatLocalTime(date: Date, timeZone: string) {
  return new Intl.DateTimeFormat("es-MX", {
    timeZone,
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

export async function assertCanManageAppointment(input: {
  isSuperAdmin: boolean;
  barberId: string | null;
  appointmentId: string;
}) {
  if (input.isSuperAdmin) return;
  const appt = await prisma.appointment.findUnique({
    where: { id: input.appointmentId },
    select: { barberId: true },
  });
  if (!appt || !input.barberId || appt.barberId !== input.barberId) {
    throw new AppError("UNAUTHORIZED", "Solo puedes gestionar tus propios cortes.", 403);
  }
}

export async function createWalkIn(input: {
  serviceId: string;
  barberId: string;
  clientName: string;
  clientPhone?: string;
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
  const durationMin = effectiveDurationMin(service.durationMin, quantity);
  const existing = await prisma.appointment.findMany({
    where: {
      barberId: barber.id,
      status: { notIn: [AppointmentStatus.CANCELLED, AppointmentStatus.NO_SHOW] },
      endAt: { gt: addMinutes(new Date(), -BUFFER) },
    },
    orderBy: { startAt: "asc" },
    select: { startAt: true, endAt: true },
  });

  const dayKey = localDayKey(new Date(), branch.timezone);
  const dayEnd = addMinutes(startOfLocalDay(dayKey, branch.timezone), 24 * 60);
  let startAt = new Date();

  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (startAt >= dayEnd) {
      throw new AppError(
        "SLOT_TAKEN",
        "Hoy ya no hay un hueco libre para ese corte con ese barbero.",
        409,
      );
    }
    const endAt = addMinutes(startAt, durationMin);
    if (assertNoOverlap({ startAt, endAt }, existing, BUFFER)) {
      const priceCents = effectivePriceCents(service.priceCents, quantity);
      const phoneDigits = (input.clientPhone ?? "").replace(/\D/g, "");
      let phone = phoneDigits;
      if (!phone) {
        phone = `L${String(Math.floor(Math.random() * 1_000_000_000)).padStart(9, "0")}`;
      } else if (!/^\d{10}$/.test(phone)) {
        throw new AppError("VALIDATION_ERROR", "El WhatsApp debe tener 10 dígitos, o déjalo vacío.", 422);
      }

      let client = phone.startsWith("L")
        ? null
        : await prisma.client.findUnique({ where: { phone } });
      if (client?.blocked) {
        throw new AppError("CLIENT_BLOCKED", "No es posible registrar un corte con este teléfono.");
      }
      if (!client) {
        client = await prisma.client.create({
          data: { name: input.clientName.trim(), phone },
        });
      } else {
        client = await prisma.client.update({
          where: { id: client.id },
          data: { name: input.clientName.trim() },
        });
      }

      const appointment = await prisma.appointment.create({
        data: {
          startAt,
          endAt,
          status: AppointmentStatus.CHECKED_IN,
          source: "WALK_IN",
          quantity,
          priceCents,
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
        include: { client: true, barber: true, service: true, payment: true },
      });
      availabilityCache.invalidatePrefix("avail:");
      const startedNow = attempt === 0;
      return {
        ...appointment,
        currency: "MXN" as const,
        message: startedNow
          ? `Corte en local de ${formatLocalTime(startAt, branch.timezone)} a ${formatLocalTime(endAt, branch.timezone)}. Ese horario queda ocupado.`
          : `No había lugar en este momento. El corte quedó de ${formatLocalTime(startAt, branch.timezone)} a ${formatLocalTime(endAt, branch.timezone)} y bloquea ese horario.`,
      };
    }

    const blocker = existing.find((appt) =>
      rangesOverlap(
        { startAt, endAt: addMinutes(startAt, durationMin) },
        { startAt: addMinutes(appt.startAt, -BUFFER), endAt: addMinutes(appt.endAt, BUFFER) },
      ),
    );
    if (!blocker) break;
    const next = addMinutes(blocker.endAt, BUFFER);
    startAt = next.getTime() > startAt.getTime() ? next : addMinutes(startAt, BUFFER);
  }

  throw new AppError(
    "SLOT_TAKEN",
    "Ese barbero no tiene un hueco libre hoy para la duración de este corte.",
    409,
  );
}

export async function listAppointments(date?: string) {
  const rows = await searchAppointments(date ? { dateFrom: date, dateTo: date } : {});
  // Agenda del día: cronológico ascendente
  return rows.slice().sort((a, b) => a.startAt.getTime() - b.startAt.getTime());
}

export type AppointmentSearchFilters = {
  dateFrom?: string;
  dateTo?: string;
  q?: string;
  serviceId?: string;
  barberId?: string;
  status?: string;
  minPriceCents?: number;
  maxPriceCents?: number;
  hasCommission?: "yes" | "no";
};

const STATUS_SEARCH: Record<string, string> = {
  SCHEDULED: "programada scheduled",
  CONFIRMED: "confirmada confirmed",
  CHECKED_IN: "check-in checkin llegada",
  COMPLETED: "completada cobrada completed",
  CANCELLED: "cancelada cancelled",
  NO_SHOW: "no llego no show",
};

function includes(token: string) {
  return { contains: token, mode: "insensitive" as const };
}

function foldSearch(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function matchSearchToken(token: string): Prisma.AppointmentWhereInput {
  const digits = token.replace(/\D/g, "");
  const or: Prisma.AppointmentWhereInput[] = [
    { client: { name: includes(token) } },
    { client: { email: includes(token) } },
    { client: { notes: includes(token) } },
    { barber: { name: includes(token) } },
    { barber: { nickname: includes(token) } },
    { service: { name: includes(token) } },
    { notes: includes(token) },
  ];
  if (digits.length >= 3) or.push({ client: { phone: { contains: digits } } });

  const folded = foldSearch(token);
  if (folded.length >= 4) {
    for (const [status, label] of Object.entries(STATUS_SEARCH)) {
      if (foldSearch(label).includes(folded)) {
        or.push({ status: status as AppointmentStatus });
      }
    }
  }

  const numeric = token.replace(/[$,]/g, "");
  if (/^\d+(\.\d{1,2})?$/.test(numeric)) {
    or.push({ priceCents: Math.round(Number(numeric) * 100) });
  }

  return { OR: or };
}

export async function searchAppointments(filters: AppointmentSearchFilters = {}) {
  const branch = await getBranch();
  const and: Prisma.AppointmentWhereInput[] = [];

  if (filters.dateFrom || filters.dateTo) {
    const startAt: { gte?: Date; lt?: Date } = {};
    if (filters.dateFrom) startAt.gte = startOfLocalDay(filters.dateFrom, branch.timezone);
    if (filters.dateTo) {
      startAt.lt = addMinutes(startOfLocalDay(filters.dateTo, branch.timezone), 24 * 60);
    }
    and.push({ startAt });
  }

  if (filters.serviceId) and.push({ serviceId: filters.serviceId });
  if (filters.barberId) and.push({ barberId: filters.barberId });
  if (filters.status && Object.values(AppointmentStatus).includes(filters.status as AppointmentStatus)) {
    and.push({ status: filters.status as AppointmentStatus });
  }
  if (filters.minPriceCents != null || filters.maxPriceCents != null) {
    and.push({
      priceCents: {
        ...(filters.minPriceCents != null ? { gte: filters.minPriceCents } : {}),
        ...(filters.maxPriceCents != null ? { lte: filters.maxPriceCents } : {}),
      },
    });
  }
  if (filters.hasCommission === "yes") and.push({ commission: { isNot: null } });
  if (filters.hasCommission === "no") and.push({ commission: { is: null } });

  const tokens = (filters.q ?? "")
    .trim()
    .split(/\s+/)
    .filter((token) => token.length > 0);
  for (const token of tokens) and.push(matchSearchToken(token));

  return prisma.appointment.findMany({
    where: and.length ? { AND: and } : {},
    include: {
      client: true,
      barber: true,
      service: true,
      payment: true,
      commission: true,
    },
    orderBy: { startAt: "desc" },
    take: 250,
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
