const MS_VENTANA = 24 * 60 * 60 * 1000;

/**
 * Texto libre solo si el cliente escribió hace menos de 24 horas.
 * Sin mensaje entrante, la ventana está cerrada y solo cabe plantilla.
 */
export function canSendFreeText(
  ultimoEntrante: Date | null | undefined,
  ahora: Date = new Date(),
): boolean {
  if (!ultimoEntrante) return false;
  const transcurrido = ahora.getTime() - ultimoEntrante.getTime();
  return transcurrido >= 0 && transcurrido < MS_VENTANA;
}
