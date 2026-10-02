import { AppointmentStatus } from "@prisma/client";
import {
  clientManageState,
  STATUS_LABELS_ES,
  type AppointmentStatus as DomainStatus,
} from "../domain/appointmentStatus.js";
import { cancellationFeeCents } from "../domain/moneyRules.js";
import { normalizePublicCode } from "../domain/publicAccess.js";
import { AppError } from "../lib/errors.js";
import { prisma } from "../lib/prisma.js";
import * as booking from "./bookingService.js";

const NOT_FOUND = "No encontramos esa cita.";
const MANAGEABLE = [AppointmentStatus.SCHEDULED, AppointmentStatus.CONFIRMED] as const;

const viewInclude = {
  client: true,
  barber: true,
  service: true,
  branch: true,
} as const;

type ViewAppointment = Awaited<ReturnType<typeof loadByToken>>;

function feePreview(appt: {
  priceCents: number;
  startAt: Date;
  branch: { cancelNoticeHours: number; lateCancelFeePercent: number };
}) {
  const feeCents = cancellationFeeCents({
    serviceCents: appt.priceCents,
    startAt: appt.startAt,
    cancelledAt: new Date(),
    noticeHours: appt.branch.cancelNoticeHours,
    lateFeePercent: appt.branch.lateCancelFeePercent,
  });
  const late = feeCents > 0;
  return {
    late,
    feeCents,
    feeMxn: feeCents / 100,
    noticeHours: appt.branch.cancelNoticeHours,
    lateFeePercent: appt.branch.lateCancelFeePercent,
    message: late
      ? `Faltan menos de ${appt.branch.cancelNoticeHours} horas. Hay un cargo de $${Math.round(feeCents / 100)} MXN (${appt.branch.lateCancelFeePercent}% de $${Math.round(appt.priceCents / 100)}) que se cobra en el local.`
      : "Se cancela sin cargo y el horario queda libre.",
  };
}

async function loadByToken(token: string) {
  const appt = await prisma.appointment.findUnique({
    where: { publicToken: token },
    include: viewInclude,
  });
  if (!appt) throw new AppError("NOT_FOUND", NOT_FOUND, 404);
  return appt;
}

function assertClientCanManage(status: AppointmentStatus) {
  const state = clientManageState(status as DomainStatus);
  if (!state.canManage) {
    throw new AppError("INVALID_STATUS_TRANSITION", state.lockMessage ?? "Esta cita ya no se puede cambiar.", 409);
  }
}

async function toView(appt: ViewAppointment) {
  const state = clientManageState(appt.status as DomainStatus);
  const others = await prisma.appointment.findMany({
    where: {
      clientId: appt.clientId,
      id: { not: appt.id },
      publicToken: { not: null },
      status: { in: [...MANAGEABLE] },
      startAt: { gt: new Date() },
    },
    orderBy: { startAt: "asc" },
    include: { service: true, barber: true },
  });

  return {
    token: appt.publicToken,
    code: appt.publicCode,
    status: appt.status,
    statusLabel: STATUS_LABELS_ES[appt.status as DomainStatus],
    canManage: state.canManage,
    lockMessage: state.lockMessage,
    clientName: appt.client.name,
    startAt: appt.startAt.toISOString(),
    endAt: appt.endAt.toISOString(),
    priceCents: appt.priceCents,
    priceMxn: appt.priceCents / 100,
    quantity: appt.quantity,
    notes: appt.notes,
    cancellationFeeCents: appt.cancellationFeeCents,
    service: {
      name: appt.service.name,
      durationMin: Math.round((appt.endAt.getTime() - appt.startAt.getTime()) / 60000),
    },
    barber: {
      id: appt.barber.id,
      name: appt.barber.name,
      nickname: appt.barber.nickname,
      slug: appt.barber.slug,
    },
    branch: {
      name: appt.branch.name,
      address: appt.branch.address,
      city: appt.branch.city,
    },
    cancellationPreview: state.canManage ? feePreview(appt) : null,
    others: others.map((other) => ({
      token: other.publicToken,
      startAt: other.startAt.toISOString(),
      endAt: other.endAt.toISOString(),
      status: other.status,
      statusLabel: STATUS_LABELS_ES[other.status as DomainStatus],
      serviceName: other.service.name,
      barberName: other.barber.name,
      barberSlug: other.barber.slug,
    })),
  };
}

export async function getPublicAppointment(token: string) {
  return toView(await loadByToken(token));
}

export function normalizeLookupPhone(raw: string) {
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 12 && digits.startsWith("52")) return digits.slice(2);
  if (digits.length === 13 && digits.startsWith("521")) return digits.slice(3);
  return digits;
}

export async function lookupPublicAppointment(phoneRaw: string, codeRaw: string) {
  const phone = normalizeLookupPhone(phoneRaw);
  const code = normalizePublicCode(codeRaw);
  if (!/^\d{10}$/.test(phone) || !/^[A-Z2-9]{6}$/.test(code)) {
    throw new AppError("NOT_FOUND", NOT_FOUND, 404);
  }

  const client = await prisma.client.findUnique({ where: { phone } });
  if (!client) throw new AppError("NOT_FOUND", NOT_FOUND, 404);

  const appt = await prisma.appointment.findFirst({
    where: { clientId: client.id, publicCode: code },
    include: viewInclude,
  });
  if (!appt?.publicToken) throw new AppError("NOT_FOUND", NOT_FOUND, 404);
  return toView(appt);
}

export async function publicSlots(token: string, date: string, barberId?: string) {
  const appt = await loadByToken(token);
  assertClientCanManage(appt.status);
  return booking.getAvailability({
    date,
    serviceId: appt.serviceId,
    barberId: barberId || appt.barberId,
    quantity: appt.quantity,
    excludeAppointmentId: appt.id,
  });
}

export async function cancelPublicAppointment(token: string) {
  const appt = await loadByToken(token);
  assertClientCanManage(appt.status);
  const cancelled = await booking.cancelAppointment(appt.id);
  return {
    view: await getPublicAppointment(token),
    cancellation: cancelled.cancellation,
  };
}

export async function reschedulePublicAppointment(token: string, startAt: string, barberId: string) {
  const appt = await loadByToken(token);
  assertClientCanManage(appt.status);
  if (
    new Date(startAt).getTime() === appt.startAt.getTime() &&
    barberId === appt.barberId
  ) {
    throw new AppError("VALIDATION_ERROR", "Esa ya es tu hora. Elige otro horario.", 422);
  }
  await booking.rescheduleAppointment(appt.id, startAt, barberId);
  return getPublicAppointment(token);
}
