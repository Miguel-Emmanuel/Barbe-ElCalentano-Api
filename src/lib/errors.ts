/**
 * Domain error codes mapped to friendly Spanish messages for the UI.
 */
export type ErrorCode =
  | "VALIDATION_ERROR"
  | "NOT_FOUND"
  | "SLOT_TAKEN"
  | "SLOT_IN_PAST"
  | "OUTSIDE_HOURS"
  | "BARBER_UNAVAILABLE"
  | "SERVICE_INACTIVE"
  | "CLIENT_BLOCKED"
  | "INVALID_STATUS_TRANSITION"
  | "CONFLICT"
  | "UNAUTHORIZED"
  | "INTERNAL_ERROR";

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details?: unknown;

  constructor(code: ErrorCode, message: string, status = 400, details?: unknown) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export const FRIENDLY_MESSAGES: Record<ErrorCode, string> = {
  VALIDATION_ERROR: "Revisa los datos e inténtalo de nuevo.",
  NOT_FOUND: "No encontramos lo que buscas.",
  SLOT_TAKEN: "Ese horario ya no está disponible. Elige otro.",
  SLOT_IN_PAST: "No puedes reservar un horario que ya pasó.",
  OUTSIDE_HOURS: "Ese horario está fuera del horario de atención.",
  BARBER_UNAVAILABLE: "El barbero no está disponible en ese momento.",
  SERVICE_INACTIVE: "Ese servicio no está disponible por ahora.",
  CLIENT_BLOCKED: "No es posible agendar con este teléfono. Contáctanos en el local.",
  INVALID_STATUS_TRANSITION: "No se puede cambiar el estado de la cita de esa forma.",
  CONFLICT: "Hay un conflicto con otra cita. Intenta de nuevo.",
  UNAUTHORIZED: "Necesitas iniciar sesión.",
  INTERNAL_ERROR: "Algo salió mal. Inténtalo en unos minutos.",
};

export function toErrorPayload(error: unknown) {
  if (error instanceof AppError) {
    return {
      ok: false as const,
      code: error.code,
      message: error.message || FRIENDLY_MESSAGES[error.code],
      details: error.details,
    };
  }

  return {
    ok: false as const,
    code: "INTERNAL_ERROR" as const,
    message: FRIENDLY_MESSAGES.INTERNAL_ERROR,
  };
}
