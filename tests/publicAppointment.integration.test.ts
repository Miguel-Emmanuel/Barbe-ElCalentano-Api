import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../src/lib/prisma";
import * as booking from "../src/services/bookingService";
import {
  cancelPublicAppointment,
  getPublicAppointment,
  lookupPublicAppointment,
  publicSlots,
  reschedulePublicAppointment,
} from "../src/services/publicAppointmentService";
import { AppError } from "../src/lib/errors";

function mexicoDate(daysAhead: number) {
  const key = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Mexico_City",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  const [year, month, day] = key.split("-").map(Number);
  const next = new Date(Date.UTC(year, month - 1, day + daysAhead));
  return next.toISOString().slice(0, 10);
}

describe("public appointment flow", () => {
  let db = false;
  const phone = `55${String(Date.now()).slice(-8)}`;
  let token = "";

  beforeAll(async () => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      db = true;
    } catch {
      db = false;
    }
  });

  afterAll(async () => {
    if (!db || !token) return;
    const row = await prisma.appointment.findUnique({ where: { publicToken: token } });
    if (row && row.status !== "CANCELLED" && row.status !== "COMPLETED") {
      await booking.cancelAppointment(row.id).catch(() => undefined);
    }
  });

  it("creates, opens, moves, and cancels a visit with the secret link", async () => {
    if (!db) return;

    const services = await booking.listServices();
    const barbers = await booking.listBarbers();
    const service = services.find((item) => !item.allowsQuantity) ?? services[0];
    const barber = barbers[0];
    const otherBarber = barbers[1] ?? barber;
    expect(service && barber).toBeTruthy();

    const date = mexicoDate(12);
    const open = await booking.getAvailability({
      date,
      serviceId: service.id,
      barberId: barber.id,
      quantity: 1,
    });
    expect(open.slots.length).toBeGreaterThan(2);

    const created = await booking.createAppointment({
      serviceId: service.id,
      barberId: barber.id,
      startAt: open.slots[1],
      clientName: "Cliente Prueba",
      clientPhone: phone,
    });
    token = created.publicToken ?? "";
    expect(token.length).toBeGreaterThan(20);
    expect(created.publicCode).toHaveLength(6);

    const view = await getPublicAppointment(token);
    expect(view.canManage).toBe(true);
    expect(view.clientName).toBe("Cliente Prueba");
    expect(view.service.name).toBe(service.name);
    expect(view.cancellationPreview?.late).toBe(false);

    await expect(lookupPublicAppointment(phone, "ZZZZZZ")).rejects.toMatchObject({
      message: "No encontramos esa cita.",
    });
    await expect(lookupPublicAppointment("5500000000", created.publicCode ?? "")).rejects.toBeInstanceOf(
      AppError,
    );

    const found = await lookupPublicAppointment(phone, created.publicCode ?? "");
    expect(found.token).toBe(token);

    const slots = await publicSlots(token, date, otherBarber.id);
    const nextSlot = slots.slots.find((slot) => slot !== created.startAt.toISOString());
    expect(nextSlot).toBeTruthy();

    const moved = await reschedulePublicAppointment(token, nextSlot!, otherBarber.id);
    expect(moved.barber.id).toBe(otherBarber.id);
    expect(moved.startAt).toBe(nextSlot);

    const staffRow = await prisma.appointment.findUnique({ where: { publicToken: token } });
    expect(staffRow?.barberId).toBe(otherBarber.id);
    expect(staffRow?.startAt.toISOString()).toBe(nextSlot);

    const cancelled = await cancelPublicAppointment(token);
    expect(cancelled.view.status).toBe("CANCELLED");
    expect(cancelled.view.canManage).toBe(false);
    expect(cancelled.cancellation.feeCents).toBe(0);
    expect(cancelled.cancellation.message).toContain("Sin cargo");

    await expect(cancelPublicAppointment(token)).rejects.toMatchObject({
      message: "Esta cita está cancelada.",
    });
  });
});
