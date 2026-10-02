import { templateBody, templateParam, whatsAppRecipient } from "../domain/whatsapp.js";

export async function sendWhatsAppTemplate(input: {
  to: string;
  template: string;
  language: string;
  parameters: string[];
}): Promise<{ status: string; detail?: string }> {
  const mode = (process.env.NOTIFY_MODE ?? "mock").toLowerCase();
  const recipient = whatsAppRecipient(input.to);
  if (!recipient) return { status: "SKIPPED_BAD_PHONE" };
  if (mode !== "whatsapp") return { status: "SENT_MOCK" };

  const token = process.env.WHATSAPP_TOKEN;
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  if (!token || !phoneNumberId) {
    return { status: "FALLBACK_MOCK_NO_WHATSAPP_CREDENTIALS" };
  }

  const version = process.env.WHATSAPP_GRAPH_VERSION ?? "v22.0";
  const parameters = input.parameters.map((text) => templateParam(text));
  const payload = JSON.parse(templateBody(input.template, parameters)) as {
    messaging_product: string;
    type: string;
    template: unknown;
  };

  const response = await fetch(
    `https://graph.facebook.com/${version}/${phoneNumberId}/messages`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ ...payload, to: recipient }),
    },
  );

  const json = (await response.json().catch(() => null)) as {
    error?: { message?: string };
    messages?: Array<{ id?: string }>;
  } | null;

  if (!response.ok) {
    return { status: "FAILED", detail: json?.error?.message ?? `HTTP ${response.status}` };
  }

  return { status: "SENT", detail: json?.messages?.[0]?.id };
}
