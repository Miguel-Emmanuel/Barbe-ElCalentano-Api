import { Router } from "express";
import type { Request, Response } from "express";
import { firmaValida, firmaYCloudValida, secretoCoincide } from "../domain/whatsapp/firma.js";
import { eventoYCloudSchema, payloadWebhookSchema } from "../domain/whatsapp/payload.js";
import { handleInbound, handleYCloudEvent } from "../services/whatsappService.js";

type SolicitudWebhook = Request & { cuerpoCrudo?: Buffer };

function leerReto(consulta: Request["query"]) {
  const plano = consulta as Record<string, unknown>;
  const hub = (plano.hub ?? {}) as Record<string, unknown>;
  return {
    modo: String(hub.mode ?? plano["hub.mode"] ?? ""),
    token: String(hub.verify_token ?? plano["hub.verify_token"] ?? ""),
    reto: String(hub.challenge ?? plano["hub.challenge"] ?? ""),
  };
}

export const webhookRouter = Router();

webhookRouter.get("/", (req, res) => {
  const esperado = process.env.WHATSAPP_VERIFY_TOKEN ?? "";
  const { modo, token, reto } = leerReto(req.query);
  if (modo !== "subscribe" || !reto || !secretoCoincide(token, esperado)) {
    res.status(403).send("forbidden");
    return;
  }
  res.status(200).type("text/plain").send(reto);
});

webhookRouter.post("/", async (req: SolicitudWebhook, res: Response) => {
  const secreto = process.env.WHATSAPP_APP_SECRET ?? "";
  const cuerpo = req.cuerpoCrudo ?? Buffer.from("");
  const firma = req.header("x-hub-signature-256") ?? undefined;
  if (!firmaValida(cuerpo, firma, secreto)) {
    res.status(403).send("forbidden");
    return;
  }

  const parsed = payloadWebhookSchema.safeParse(req.body);
  if (!parsed.success) {
    console.error("whatsapp webhook", parsed.error.issues[0]?.message ?? "payload inválido");
    res.status(200).json({ ok: true });
    return;
  }

  try {
    await handleInbound(parsed.data);
  } catch (error) {
    console.error("whatsapp webhook", error instanceof Error ? error.message : error);
  }
  res.status(200).json({ ok: true });
});

export const webhookYCloudRouter = Router();

webhookYCloudRouter.post("/", async (req: SolicitudWebhook, res: Response) => {
  const secreto = process.env.YCLOUD_WEBHOOK_SECRET ?? "";
  const cuerpo = req.cuerpoCrudo ?? Buffer.from("");
  const firma = req.header("ycloud-signature") ?? undefined;
  if (!firmaYCloudValida(cuerpo, firma, secreto)) {
    res.status(403).send("forbidden");
    return;
  }

  const parsed = eventoYCloudSchema.safeParse(req.body);
  if (!parsed.success) {
    console.error("ycloud webhook", parsed.error.issues[0]?.message ?? "payload inválido");
    res.status(200).json({ ok: true });
    return;
  }

  try {
    await handleYCloudEvent(parsed.data);
  } catch (error) {
    console.error("ycloud webhook", error instanceof Error ? error.message : error);
    res.status(500).json({ ok: false });
    return;
  }
  res.status(200).json({ ok: true });
});
