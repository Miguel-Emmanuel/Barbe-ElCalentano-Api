import { z } from "zod";

const mensajeEntrante = z.object({
  from: z.string().min(8),
  id: z.string().min(1),
  timestamp: z.string().min(1),
  type: z.string().min(1),
  text: z.object({ body: z.string() }).optional(),
});

const estadoEntrega = z.object({
  id: z.string().min(1),
  status: z.string().min(1),
  timestamp: z.string().min(1),
  recipient_id: z.string().optional(),
  errors: z
    .array(
      z.object({
        code: z.number().optional(),
        title: z.string().optional(),
        message: z.string().optional(),
      }),
    )
    .optional(),
});

const valorCambio = z.object({
  messaging_product: z.string().optional(),
  metadata: z
    .object({
      display_phone_number: z.string().optional(),
      phone_number_id: z.string().optional(),
    })
    .optional(),
  contacts: z
    .array(
      z.object({
        wa_id: z.string().optional(),
        profile: z.object({ name: z.string().optional() }).optional(),
      }),
    )
    .optional(),
  messages: z.array(mensajeEntrante).optional(),
  statuses: z.array(estadoEntrega).optional(),
});

export const payloadWebhookSchema = z.object({
  object: z.literal("whatsapp_business_account"),
  entry: z.array(
    z.object({
      id: z.string(),
      changes: z.array(
        z.object({
          field: z.string(),
          value: valorCambio,
        }),
      ),
    }),
  ),
});

export type PayloadWebhook = z.infer<typeof payloadWebhookSchema>;

const mensajeEntranteYCloud = z.object({
  id: z.string().min(1),
  wamid: z.string().optional(),
  from: z.string().min(8),
  to: z.string().optional(),
  sendTime: z.string().optional(),
  type: z.string().min(1),
  text: z.object({ body: z.string() }).optional(),
});

const mensajeSalienteYCloud = z.object({
  id: z.string().min(1),
  wamid: z.string().optional(),
  status: z.string().min(1),
  errorCode: z.string().optional(),
  errorMessage: z.string().optional(),
});

export const eventoYCloudSchema = z.object({
  id: z.string().min(1),
  type: z.string().min(1),
  createTime: z.string().optional(),
  whatsappInboundMessage: mensajeEntranteYCloud.optional(),
  whatsappMessage: mensajeSalienteYCloud.optional(),
});

export type EventoYCloud = z.infer<typeof eventoYCloudSchema>;
