export type TimeRange = {
  startAt: Date;
  endAt: Date;
};

export type BusinessDayWindow = {
  dayOfWeek: number; // 0 = Sunday ... 6 = Saturday
  openMin: number; // minutes from midnight
  closeMin: number;
  closed: boolean;
  byAppointmentOnly: boolean;
};

export const DEFAULT_BUFFER_MINUTES = 5;
export const DEFAULT_SLOT_STEP_MINUTES = 10;

/** True if two half-open ranges [start, end) overlap. */
export function rangesOverlap(a: TimeRange, b: TimeRange): boolean {
  return a.startAt < b.endAt && b.startAt < a.endAt;
}

export function addMinutes(date: Date, minutes: number): Date {
  return new Date(date.getTime() + minutes * 60_000);
}

export function minutesOfDay(date: Date, timeZone = "America/Mexico_City"): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);

  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? "0");
  const minute = Number(parts.find((p) => p.type === "minute")?.value ?? "0");
  const h = hour === 24 ? 0 : hour;
  return h * 60 + minute;
}

export function dayOfWeekInTz(date: Date, timeZone = "America/Mexico_City"): number {
  const weekday = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
  }).format(date);

  const map: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };
  return map[weekday] ?? date.getUTCDay();
}

/**
 * Midnight of `YYYY-MM-DD` in the given IANA timezone.
 * Uses noon probe + shortOffset so DST is handled correctly.
 */
export function startOfLocalDay(dateStr: string, timeZone = "America/Mexico_City"): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    throw new Error(`Invalid date key: ${dateStr}`);
  }
  const probe = new Date(`${dateStr}T12:00:00.000Z`);
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone,
    timeZoneName: "shortOffset",
  });
  const parts = fmt.formatToParts(probe);
  const tzName = parts.find((p) => p.type === "timeZoneName")?.value ?? "GMT-6";
  const match = tzName.match(/GMT([+-]\d+)(?::(\d+))?/);
  const hours = match ? Number(match[1]) : -6;
  const mins = match?.[2] ? Number(match[2]) : 0;
  const sign = hours <= 0 ? "-" : "+";
  const offset = `${sign}${String(Math.abs(hours)).padStart(2, "0")}:${String(mins).padStart(2, "0")}`;
  return new Date(`${dateStr}T00:00:00${offset}`);
}

export function isWithinBusinessHours(
  startAt: Date,
  endAt: Date,
  window: BusinessDayWindow | undefined,
  timeZone = "America/Mexico_City",
): boolean {
  if (!window || window.closed) return false;
  if (dayOfWeekInTz(startAt, timeZone) !== window.dayOfWeek) return false;
  if (dayOfWeekInTz(endAt, timeZone) !== window.dayOfWeek) return false;

  const startMin = minutesOfDay(startAt, timeZone);
  const endMin = minutesOfDay(endAt, timeZone);
  return startMin >= window.openMin && endMin <= window.closeMin;
}

/**
 * Find free slots for a barber on a calendar day.
 * Fixed start grid (default 10 min) + duration-aware occupancy + buffer.
 * Existing appointments must belong to the SAME barber (caller filters).
 */
export function findAvailableSlots(params: {
  dayStart: Date;
  openMin: number;
  closeMin: number;
  durationMin: number;
  bufferMin?: number;
  slotStepMin?: number;
  existing: TimeRange[];
  now?: Date;
}): Date[] {
  const buffer = params.bufferMin ?? DEFAULT_BUFFER_MINUTES;
  const slotStep = Math.max(1, params.slotStepMin ?? DEFAULT_SLOT_STEP_MINUTES);
  const openAt = addMinutes(params.dayStart, params.openMin);
  const closeAt = addMinutes(params.dayStart, params.closeMin);
  const now = params.now ?? new Date();

  const busy = [...params.existing].sort((a, b) => a.startAt.getTime() - b.startAt.getTime());
  const slots: Date[] = [];

  for (
    let cursor = openAt;
    addMinutes(cursor, params.durationMin) <= closeAt;
    cursor = addMinutes(cursor, slotStep)
  ) {
    if (cursor < now) continue;

    const candidate: TimeRange = {
      startAt: cursor,
      endAt: addMinutes(cursor, params.durationMin),
    };

    const conflicts = busy.some((appt) =>
      rangesOverlap(candidate, {
        startAt: appt.startAt,
        endAt: addMinutes(appt.endAt, buffer),
      }),
    );

    const tooCloseBefore = busy.some((appt) => {
      const guardedStart = addMinutes(appt.startAt, -buffer);
      return candidate.endAt > guardedStart && candidate.startAt < appt.startAt;
    });

    if (!conflicts && !tooCloseBefore) {
      slots.push(new Date(cursor));
    }
  }

  return slots;
}

export function assertNoOverlap(
  candidate: TimeRange,
  existing: TimeRange[],
  bufferMin = DEFAULT_BUFFER_MINUTES,
): boolean {
  return !existing.some((appt) =>
    rangesOverlap(candidate, {
      startAt: addMinutes(appt.startAt, -bufferMin),
      endAt: addMinutes(appt.endAt, bufferMin),
    }),
  );
}

export function effectiveDurationMin(baseDurationMin: number, quantity: number): number {
  const qty = Math.max(1, quantity);
  return baseDurationMin * qty;
}

export function effectivePriceCents(basePriceCents: number, quantity: number): number {
  const qty = Math.max(1, quantity);
  return basePriceCents * qty;
}
