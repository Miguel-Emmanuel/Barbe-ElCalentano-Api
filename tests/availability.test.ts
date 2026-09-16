import { describe, expect, it } from "vitest";
import {
  addMinutes,
  assertNoOverlap,
  effectiveDurationMin,
  effectivePriceCents,
  findAvailableSlots,
  rangesOverlap,
  startOfLocalDay,
} from "../src/domain/availability";
import {
  cancellationFeeCents,
  depositAmountCents,
  loyaltyPointsEarned,
  splitEarnings,
} from "../src/domain/moneyRules";
import {
  assertStatusTransition,
  canMarkPaid,
  isTerminalStatus,
  staffActionsFor,
} from "../src/domain/appointmentStatus";
import { AppError, FRIENDLY_MESSAGES, toErrorPayload } from "../src/lib/errors";
import { hashPassword } from "../src/lib/password";
import { TtlCache } from "../src/lib/cache";

describe("rangesOverlap", () => {
  it("detects overlapping intervals", () => {
    const a = { startAt: new Date("2026-09-15T10:00:00Z"), endAt: new Date("2026-09-15T10:40:00Z") };
    const b = { startAt: new Date("2026-09-15T10:20:00Z"), endAt: new Date("2026-09-15T11:00:00Z") };
    expect(rangesOverlap(a, b)).toBe(true);
  });

  it("allows adjacent intervals without overlap", () => {
    const a = { startAt: new Date("2026-09-15T10:00:00Z"), endAt: new Date("2026-09-15T10:40:00Z") };
    const b = { startAt: new Date("2026-09-15T10:40:00Z"), endAt: new Date("2026-09-15T11:20:00Z") };
    expect(rangesOverlap(a, b)).toBe(false);
  });
});

describe("assertNoOverlap with buffer", () => {
  it("blocks slots inside buffer after an appointment", () => {
    const existing = [
      { startAt: new Date("2026-09-15T15:00:00Z"), endAt: new Date("2026-09-15T15:40:00Z") },
    ];
    const candidate = {
      startAt: new Date("2026-09-15T15:40:00Z"),
      endAt: new Date("2026-09-15T16:20:00Z"),
    };
    expect(assertNoOverlap(candidate, existing, 5)).toBe(false);
  });

  it("allows slot after buffer", () => {
    const existing = [
      { startAt: new Date("2026-09-15T15:00:00Z"), endAt: new Date("2026-09-15T15:40:00Z") },
    ];
    const candidate = {
      startAt: new Date("2026-09-15T15:45:00Z"),
      endAt: new Date("2026-09-15T16:25:00Z"),
    };
    expect(assertNoOverlap(candidate, existing, 5)).toBe(true);
  });
});

describe("findAvailableSlots", () => {
  const dayStart = new Date("2026-09-15T00:00:00Z");

  it("returns slots that fit duration within open hours", () => {
    const slots = findAvailableSlots({
      dayStart,
      openMin: 10 * 60,
      closeMin: 12 * 60,
      durationMin: 40,
      bufferMin: 5,
      existing: [],
      now: new Date("2026-09-14T00:00:00Z"),
    });
    expect(slots.length).toBeGreaterThan(0);
    expect(slots[0].toISOString()).toBe(addMinutes(dayStart, 10 * 60).toISOString());
  });

  it("skips past starts when now is mid-day", () => {
    const slots = findAvailableSlots({
      dayStart,
      openMin: 10 * 60,
      closeMin: 12 * 60,
      durationMin: 40,
      bufferMin: 5,
      existing: [],
      now: addMinutes(dayStart, 11 * 60),
    });
    expect(slots.every((s) => s >= addMinutes(dayStart, 11 * 60))).toBe(true);
    expect(slots[0]?.toISOString()).toBe(addMinutes(dayStart, 11 * 60).toISOString());
  });

  it("blocks starts that collide with a longer existing service + buffer", () => {
    const existing = [
      {
        startAt: addMinutes(dayStart, 10 * 60),
        endAt: addMinutes(dayStart, 10 * 60 + 40),
      },
    ];
    const slots = findAvailableSlots({
      dayStart,
      openMin: 10 * 60,
      closeMin: 14 * 60,
      durationMin: 40,
      bufferMin: 5,
      existing,
      now: new Date("2026-09-14T00:00:00Z"),
    });
    const blocked = addMinutes(dayStart, 10 * 60 + 40); // 10:40 — inside buffer
    const firstOk = addMinutes(dayStart, 10 * 60 + 50); // 10:50 on 10-min grid
    expect(slots.some((s) => s.getTime() === blocked.getTime())).toBe(false);
    expect(slots.some((s) => s.getTime() === firstOk.getTime())).toBe(true);
  });

  it("leaves a short gap usable for a short service but not a long one", () => {
    const existing = [
      {
        startAt: addMinutes(dayStart, 10 * 60),
        endAt: addMinutes(dayStart, 10 * 60 + 40),
      },
      {
        startAt: addMinutes(dayStart, 11 * 60 + 20),
        endAt: addMinutes(dayStart, 12 * 60),
      },
    ];
    const shortSlots = findAvailableSlots({
      dayStart,
      openMin: 10 * 60,
      closeMin: 14 * 60,
      durationMin: 15,
      bufferMin: 5,
      existing,
      now: new Date("2026-09-14T00:00:00Z"),
    });
    const longSlots = findAvailableSlots({
      dayStart,
      openMin: 10 * 60,
      closeMin: 14 * 60,
      durationMin: 60,
      bufferMin: 5,
      existing,
      now: new Date("2026-09-14T00:00:00Z"),
    });
    const gapStart = addMinutes(dayStart, 10 * 60 + 50); // 10:50
    expect(shortSlots.some((s) => s.getTime() === gapStart.getTime())).toBe(true);
    expect(longSlots.some((s) => s.getTime() === gapStart.getTime())).toBe(false);
  });

  it("does not let other barber busy times affect when existing is empty for this barber", () => {
    // Caller is responsible for filtering by barberId — empty existing = fully free
    const slots = findAvailableSlots({
      dayStart,
      openMin: 10 * 60,
      closeMin: 11 * 60,
      durationMin: 40,
      bufferMin: 5,
      existing: [],
      now: new Date("2026-09-14T00:00:00Z"),
    });
    expect(slots.length).toBeGreaterThan(0);
  });

  it("respects custom slotStepMin", () => {
    const slots = findAvailableSlots({
      dayStart,
      openMin: 10 * 60,
      closeMin: 10 * 60 + 30,
      durationMin: 10,
      bufferMin: 0,
      slotStepMin: 5,
      existing: [],
      now: new Date("2026-09-14T00:00:00Z"),
    });
    expect(slots.map((s) => s.toISOString())).toEqual([
      addMinutes(dayStart, 10 * 60).toISOString(),
      addMinutes(dayStart, 10 * 60 + 5).toISOString(),
      addMinutes(dayStart, 10 * 60 + 10).toISOString(),
      addMinutes(dayStart, 10 * 60 + 15).toISOString(),
      addMinutes(dayStart, 10 * 60 + 20).toISOString(),
    ]);
  });
});

describe("startOfLocalDay", () => {
  it("returns midnight in America/Mexico_City for a date key", () => {
    const start = startOfLocalDay("2026-09-15", "America/Mexico_City");
    expect(start.toISOString()).toBe("2026-09-15T06:00:00.000Z"); // UTC-6
  });
});

describe("money rules", () => {
  it("splits commission and tip correctly", () => {
    const r = splitEarnings({ serviceCents: 12000, tipCents: 2000, commissionPercent: 50 });
    expect(r.barberEarnCents).toBe(8000);
    expect(r.shopEarnCents).toBe(6000);
  });

  it("charges late cancel fee inside notice window", () => {
    const fee = cancellationFeeCents({
      serviceCents: 26000,
      startAt: new Date("2026-09-20T18:00:00Z"),
      cancelledAt: new Date("2026-09-20T10:00:00Z"),
      noticeHours: 24,
      lateFeePercent: 50,
    });
    expect(fee).toBe(13000);
  });

  it("no fee when cancelled early", () => {
    const fee = cancellationFeeCents({
      serviceCents: 26000,
      startAt: new Date("2026-09-22T18:00:00Z"),
      cancelledAt: new Date("2026-09-20T10:00:00Z"),
      noticeHours: 24,
      lateFeePercent: 50,
    });
    expect(fee).toBe(0);
  });

  it("loyalty points per 100 MXN", () => {
    expect(loyaltyPointsEarned(26000, 1)).toBe(2);
    expect(loyaltyPointsEarned(9900, 1)).toBe(0);
  });

  it("deposit percent", () => {
    expect(depositAmountCents(20000, 20)).toBe(4000);
  });
});

describe("pricing and duration", () => {
  it("multiplies eyebrow quantity", () => {
    expect(effectivePriceCents(2500, 2)).toBe(5000);
    expect(effectiveDurationMin(15, 2)).toBe(30);
  });
});

describe("appointment status transitions", () => {
  it("allows check-in from scheduled", () => {
    expect(() => assertStatusTransition("SCHEDULED", "CHECKED_IN")).not.toThrow();
  });

  it("blocks completing via status patch", () => {
    expect(() => assertStatusTransition("SCHEDULED", "COMPLETED")).toThrow(AppError);
    expect(() => assertStatusTransition("CHECKED_IN", "COMPLETED")).toThrow(AppError);
  });

  it("blocks invalid transitions", () => {
    expect(() => assertStatusTransition("COMPLETED", "SCHEDULED")).toThrow(AppError);
    expect(() => assertStatusTransition("CANCELLED", "CHECKED_IN")).toThrow(AppError);
    expect(() => assertStatusTransition("NO_SHOW", "CANCELLED")).toThrow(AppError);
  });

  it("only allows charge after check-in", () => {
    expect(canMarkPaid("SCHEDULED")).toBe(false);
    expect(canMarkPaid("CHECKED_IN")).toBe(true);
    expect(canMarkPaid("CANCELLED")).toBe(false);
  });

  it("exposes staff actions by status", () => {
    expect(staffActionsFor("SCHEDULED")).toMatchObject({
      canCheckIn: true,
      canCharge: false,
      canCancel: true,
      canNoShow: true,
      readOnly: false,
    });
    expect(staffActionsFor("CHECKED_IN")).toMatchObject({
      canCheckIn: false,
      canCharge: true,
      canCancel: true,
    });
    expect(staffActionsFor("COMPLETED")).toMatchObject({
      readOnly: true,
      canCharge: false,
      canCancel: false,
    });
    expect(isTerminalStatus("NO_SHOW")).toBe(true);
  });
});

describe("friendly errors", () => {
  it("maps AppError to payload", () => {
    const payload = toErrorPayload(new AppError("SLOT_TAKEN", FRIENDLY_MESSAGES.SLOT_TAKEN, 409));
    expect(payload.ok).toBe(false);
    expect(payload.code).toBe("SLOT_TAKEN");
  });
});

describe("auth hash", () => {
  it("is deterministic", () => {
    expect(hashPassword("calentano123")).toBe(hashPassword("calentano123"));
  });
});

describe("ttl cache", () => {
  it("stores and expires conceptually via clear", () => {
    const cache = new TtlCache<string>(60_000);
    cache.set("a", "1");
    expect(cache.get("a")).toBe("1");
    cache.invalidatePrefix("a");
    expect(cache.get("a")).toBeUndefined();
  });
});
