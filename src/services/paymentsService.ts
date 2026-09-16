import { depositAmountCents } from "../domain/moneyRules.js";
import { AppError } from "../lib/errors.js";

const MODE = (process.env.PAYMENTS_MODE ?? "mock").toLowerCase();

export async function createDepositIntent(input: {
  appointmentId: string;
  serviceCents: number;
  depositPercent: number;
}) {
  const amount = depositAmountCents(input.serviceCents, input.depositPercent);
  if (amount <= 0) {
    return {
      mode: MODE,
      required: false,
      amountCents: 0,
      currency: "MXN" as const,
      message: "No se requiere depósito.",
    };
  }

  if (MODE === "stripe" && process.env.STRIPE_SECRET_KEY) {
    return {
      mode: "stripe" as const,
      required: true,
      amountCents: amount,
      currency: "MXN" as const,
      clientSecret: `pi_mock_${input.appointmentId}`,
      message: "Depósito Stripe listo (modo configurado).",
    };
  }

  return {
    mode: "mock" as const,
    required: true,
    amountCents: amount,
    currency: "MXN" as const,
    message:
      "Depósito calculado. En local el cobro es en el local; configura Stripe para online.",
  };
}

export function assertValidTip(tipCents: number) {
  if (!Number.isFinite(tipCents) || tipCents < 0) {
    throw new AppError("VALIDATION_ERROR", "La propina no puede ser negativa.", 422);
  }
  if (tipCents > 50_000_00) {
    throw new AppError("VALIDATION_ERROR", "Propina fuera de rango.", 422);
  }
}
