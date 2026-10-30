ALTER TABLE "Client" ADD COLUMN "lastInboundAt" TIMESTAMP(3);

CREATE TABLE "WhatsappMessage" (
    "id" TEXT NOT NULL,
    "citaId" TEXT,
    "clientId" TEXT,
    "direction" TEXT NOT NULL,
    "templateName" TEXT,
    "body" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL,
    "metaMessageId" TEXT,
    "errorDetail" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WhatsappMessage_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "WhatsappMessage_citaId_idx" ON "WhatsappMessage"("citaId");
CREATE INDEX "WhatsappMessage_clientId_idx" ON "WhatsappMessage"("clientId");
CREATE INDEX "WhatsappMessage_metaMessageId_idx" ON "WhatsappMessage"("metaMessageId");

ALTER TABLE "WhatsappMessage" ADD CONSTRAINT "WhatsappMessage_citaId_fkey" FOREIGN KEY ("citaId") REFERENCES "Appointment"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "WhatsappMessage" ADD CONSTRAINT "WhatsappMessage_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE;
