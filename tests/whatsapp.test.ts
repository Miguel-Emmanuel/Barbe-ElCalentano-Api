import { describe, expect, it } from "vitest";
import {
  barberTemplate,
  clientTemplate,
  templateParam,
  whatsAppRecipient,
} from "../src/domain/whatsapp.js";

describe("whatsAppRecipient", () => {
  it("acepta 10 dígitos y les pone 52", () => {
    expect(whatsAppRecipient("55 1112 2233")).toBe("525511122233");
  });

  it("quita el 52 o 521 si ya vienen", () => {
    expect(whatsAppRecipient("525511122233")).toBe("525511122233");
    expect(whatsAppRecipient("5215511122233")).toBe("525511122233");
  });

  it("rechaza números incompletos", () => {
    expect(whatsAppRecipient("551112")).toBeNull();
    expect(whatsAppRecipient("")).toBeNull();
    expect(whatsAppRecipient(null)).toBeNull();
  });
});

describe("plantillas de cita", () => {
  const startAt = new Date("2026-09-30T16:00:00.000Z");

  it("arma la confirmación con código y sin saltos de línea", () => {
    const built = clientTemplate("CONFIRMATION", {
      clientName: "Cliente\nVista",
      serviceName: "Corte de cabello",
      barberName: "Alex Ibarra",
      startAt,
      timeZone: "America/Mexico_City",
      publicCode: "3ERRVC",
    });
    expect(built.template).toBe("cita_confirmada");
    expect(built.parameters[0]).toBe("Cliente Vista");
    expect(built.parameters[5]).toBe("3ERRVC");
    expect(built.parameters.join("")).not.toMatch(/[\r\n]/);
  });

  it("la cancelación tardía menciona el cargo del local", () => {
    const built = clientTemplate("CANCEL", {
      clientName: "Cliente Vista",
      serviceName: "Corte de cabello",
      barberName: "Alex Ibarra",
      startAt,
      timeZone: "America/Mexico_City",
      publicCode: "3ERRVC",
      feeMxn: 60,
    });
    expect(built.template).toBe("cita_cancelada");
    expect(built.parameters[5]).toContain("$60 MXN");
  });

  it("el aviso del barbero no va vacío", () => {
    const built = barberTemplate({
      headline: "Nueva cita",
      clientName: "Cliente Vista",
      serviceName: "Corte de cabello",
      startAt,
      timeZone: "America/Mexico_City",
      publicCode: null,
    });
    expect(built.parameters.every((part) => part.length > 0)).toBe(true);
    expect(templateParam("   ")).toBe("-");
  });
});
