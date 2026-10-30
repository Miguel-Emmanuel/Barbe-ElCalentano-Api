import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  barberTemplate,
  clientTemplate,
  templateParam,
  whatsAppRecipient,
  canSendFreeText,
  firmaValida,
  firmaYCloudValida,
  telefonoE164,
} from "../src/domain/whatsapp/index.js";

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

describe("telefono E.164 y ventana de 24h", () => {
  it("agrega el signo de E.164", () => {
    expect(telefonoE164("55 1112 2233")).toBe("+525511122233");
  });

  it("permite texto libre solo dentro de las 24 horas", () => {
    const ahora = new Date("2026-10-08T18:00:00.000Z");
    const hace23h = new Date(ahora.getTime() - 23 * 60 * 60 * 1000);
    const hace24h = new Date(ahora.getTime() - 24 * 60 * 60 * 1000);
    expect(canSendFreeText(hace23h, ahora)).toBe(true);
    expect(canSendFreeText(hace24h, ahora)).toBe(false);
    expect(canSendFreeText(null, ahora)).toBe(false);
  });

  it("valida la firma sha256 del cuerpo crudo", () => {
    const cuerpo = Buffer.from('{"object":"whatsapp_business_account"}');
    const secreto = "secreto-de-prueba";
    const firma = `sha256=${createHmac("sha256", secreto).update(cuerpo).digest("hex")}`;
    expect(firmaValida(cuerpo, firma, secreto)).toBe(true);
    expect(firmaValida(cuerpo, "sha256=0000", secreto)).toBe(false);
    expect(firmaValida(cuerpo, firma, "")).toBe(false);
  });

  it("valida la firma de YCloud con timestamp y rechaza firmas viejas", () => {
    const cuerpo = Buffer.from('{"id":"evt_1","type":"whatsapp.message.updated"}');
    const secreto = "whsec_prueba";
    const ahora = Date.parse("2026-10-30T05:00:00.000Z");
    const t = String(Math.floor(ahora / 1000));
    const s = createHmac("sha256", secreto).update(`${t}.`).update(cuerpo).digest("hex");
    expect(firmaYCloudValida(cuerpo, `t=${t},s=${s}`, secreto, ahora)).toBe(true);
    expect(firmaYCloudValida(cuerpo, `t=${t},s=${s}`, secreto, ahora + 10 * 60 * 1000)).toBe(false);
    expect(firmaYCloudValida(cuerpo, `t=${t},s=${"0".repeat(64)}`, secreto, ahora)).toBe(false);
    expect(firmaYCloudValida(cuerpo, `t=${t},s=${s}`, "", ahora)).toBe(false);
  });
});
