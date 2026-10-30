import "dotenv/config";
import { TEXTOS_PLANTILLAS } from "../src/domain/whatsapp/templates.js";

const BASE = "https://api.ycloud.com/v2";
const llave = process.env.YCLOUD_API_KEY ?? "";
const idioma = process.env.WHATSAPP_TEMPLATE_LANG ?? "es_MX";

async function ycloud(metodo: string, ruta: string, cuerpo?: unknown) {
  const respuesta = await fetch(`${BASE}${ruta}`, {
    method: metodo,
    headers: { "X-API-Key": llave, "Content-Type": "application/json" },
    body: cuerpo ? JSON.stringify(cuerpo) : undefined,
  });
  const json = await respuesta.json().catch(() => null);
  return { ok: respuesta.ok, status: respuesta.status, json };
}

async function wabaId() {
  if (process.env.YCLOUD_WABA_ID) return process.env.YCLOUD_WABA_ID;
  const { json } = await ycloud("GET", "/whatsapp/phoneNumbers");
  const id = (json as { items?: Array<{ wabaId?: string }> } | null)?.items?.[0]?.wabaId;
  if (!id) throw new Error("No hay número conectado en YCloud.");
  return id;
}

async function plantillas() {
  const waba = await wabaId();
  for (const plantilla of TEXTOS_PLANTILLAS) {
    const { ok, status, json } = await ycloud("POST", "/whatsapp/templates", {
      wabaId: waba,
      name: plantilla.nombre,
      language: idioma,
      category: "UTILITY",
      components: [
        {
          type: "BODY",
          text: plantilla.texto,
          example: { body_text: [plantilla.ejemplo] },
        },
      ],
    });
    const estado = (json as { status?: string; message?: string } | null) ?? {};
    console.log(`${plantilla.nombre}: ${ok ? estado.status ?? "creada" : `HTTP ${status} ${JSON.stringify(json)}`}`);
  }
}

async function editar(nombres: string[]) {
  const waba = await wabaId();
  for (const plantilla of TEXTOS_PLANTILLAS.filter((item) => nombres.includes(item.nombre))) {
    const { ok, status, json } = await ycloud(
      "PATCH",
      `/whatsapp/templates/${waba}/${plantilla.nombre}/${idioma}`,
      {
        components: [
          {
            type: "BODY",
            text: plantilla.texto,
            example: { body_text: [plantilla.ejemplo] },
          },
        ],
      },
    );
    const estado = (json as { status?: string } | null) ?? {};
    console.log(`${plantilla.nombre}: ${ok ? estado.status ?? "editada" : `HTTP ${status} ${JSON.stringify(json)}`}`);
  }
}

async function estado() {
  const waba = await wabaId();
  const { json } = await ycloud("GET", `/whatsapp/templates?filter.wabaId=${waba}&limit=50`);
  const items = (json as { items?: Array<Record<string, unknown>> } | null)?.items ?? [];
  for (const item of items) {
    console.log(`${item.name} (${item.language}): ${item.status}${item.reason ? ` - ${item.reason}` : ""}`);
  }
  if (items.length === 0) console.log("Sin plantillas.");
}

async function webhook(url: string) {
  const { ok, status, json } = await ycloud("POST", "/webhookEndpoints", {
    url,
    enabledEvents: ["whatsapp.inbound_message.received", "whatsapp.message.updated"],
    description: "EL CALENTANO API",
  });
  if (!ok) {
    console.log(`HTTP ${status} ${JSON.stringify(json)}`);
    return;
  }
  const secreto = (json as { secret?: string }).secret;
  console.log(`Webhook creado. Pon YCLOUD_WEBHOOK_SECRET=${secreto}`);
}

async function prueba(destino: string) {
  const desde = process.env.YCLOUD_FROM ?? "";
  const plantilla = TEXTOS_PLANTILLAS[0];
  const { ok, status, json } = await ycloud("POST", "/whatsapp/messages/sendDirectly", {
    from: `+52${desde.replace(/\D/g, "").slice(-10)}`,
    to: `+52${destino.replace(/\D/g, "").slice(-10)}`,
    type: "template",
    template: {
      name: plantilla.nombre,
      language: { code: idioma },
      components: [
        { type: "body", parameters: plantilla.ejemplo.map((text) => ({ type: "text", text })) },
      ],
    },
  });
  console.log(ok ? `Enviado: ${JSON.stringify(json)}` : `HTTP ${status} ${JSON.stringify(json)}`);
}

async function main() {
  if (!llave) throw new Error("Falta YCLOUD_API_KEY en .env");
  const [comando, argumento, ...resto] = process.argv.slice(2);
  if (comando === "plantillas") return plantillas();
  if (comando === "editar" && argumento) return editar([argumento, ...resto]);
  if (comando === "estado") return estado();
  if (comando === "webhook" && argumento) return webhook(argumento);
  if (comando === "prueba" && argumento) return prueba(argumento);
  console.log(
    "Uso: tsx scripts/ycloudSetup.ts plantillas | editar <nombre...> | estado | webhook <url> | prueba <10 dígitos>",
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
