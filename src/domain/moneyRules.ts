/** Barber gets tip 100% + commission% of service; shop keeps the rest. */
export function splitEarnings(input: {
  serviceCents: number;
  tipCents: number;
  commissionPercent: number;
}) {
  const pct = Math.min(100, Math.max(0, input.commissionPercent));
  const barberFromService = Math.round((input.serviceCents * pct) / 100);
  return {
    barberEarnCents: barberFromService + Math.max(0, input.tipCents),
    shopEarnCents: input.serviceCents - barberFromService,
    tipToBarberCents: Math.max(0, input.tipCents),
    commissionPercent: pct,
  };
}

/** Late cancel fee if cancelled within notice window. */
export function cancellationFeeCents(input: {
  serviceCents: number;
  startAt: Date;
  cancelledAt: Date;
  noticeHours: number;
  lateFeePercent: number;
}) {
  const late =
    input.startAt.getTime() - input.cancelledAt.getTime() <
    input.noticeHours * 60 * 60 * 1000;
  if (!late) return 0;
  return Math.round(
    (input.serviceCents * Math.min(100, Math.max(0, input.lateFeePercent))) / 100,
  );
}

export function loyaltyPointsEarned(spendCents: number, pointsPer100Mxn: number) {
  if (spendCents <= 0 || pointsPer100Mxn <= 0) return 0;
  return Math.floor(spendCents / 100 / 100) * pointsPer100Mxn;
}

export function depositAmountCents(serviceCents: number, depositPercent: number) {
  return Math.round(
    (serviceCents * Math.min(100, Math.max(0, depositPercent))) / 100,
  );
}
