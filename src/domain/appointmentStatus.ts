import { AppError } from "../lib/errors.js";

export type AppointmentStatus =
  | "SCHEDULED"
  | "CONFIRMED"
  | "CHECKED_IN"
  | "COMPLETED"
  | "CANCELLED"
  | "NO_SHOW";

/**
 * Operational FSM for barbershop floor:
 * Programada → (opc Confirmada) → Check-in → Cobrar(=COMPLETED)
 * Cancel / No-show are terminals from pre-completed states.
 * COMPLETED is only reached via markPaid (not via status PATCH).
 */
const ALLOWED: Record<AppointmentStatus, AppointmentStatus[]> = {
  SCHEDULED: ["CONFIRMED", "CHECKED_IN", "CANCELLED", "NO_SHOW"],
  CONFIRMED: ["CHECKED_IN", "CANCELLED", "NO_SHOW"],
  CHECKED_IN: ["CANCELLED", "NO_SHOW"],
  COMPLETED: [],
  CANCELLED: [],
  NO_SHOW: [],
};

export function assertStatusTransition(from: AppointmentStatus, to: AppointmentStatus) {
  if (from === to) return;
  if (!ALLOWED[from].includes(to)) {
    throw new AppError(
      "INVALID_STATUS_TRANSITION",
      `No se puede pasar de ${from} a ${to}.`,
      409,
    );
  }
}

export function canMarkPaid(status: AppointmentStatus): boolean {
  return status === "CHECKED_IN";
}

export function isTerminalStatus(status: AppointmentStatus): boolean {
  return status === "COMPLETED" || status === "CANCELLED" || status === "NO_SHOW";
}

/** Staff UI action flags derived from status. */
export function staffActionsFor(status: AppointmentStatus) {
  const terminal = isTerminalStatus(status);
  return {
    canCheckIn: status === "SCHEDULED" || status === "CONFIRMED",
    canConfirm: status === "SCHEDULED",
    canCharge: status === "CHECKED_IN",
    canCancel: !terminal && status !== "COMPLETED",
    canNoShow: status === "SCHEDULED" || status === "CONFIRMED" || status === "CHECKED_IN",
    readOnly: terminal,
  };
}

export const STATUS_LABELS_ES: Record<AppointmentStatus, string> = {
  SCHEDULED: "Programada",
  CONFIRMED: "Confirmada",
  CHECKED_IN: "Check-in",
  COMPLETED: "Completada",
  CANCELLED: "Cancelada",
  NO_SHOW: "No show",
};
