-- AlterTable
ALTER TABLE "Appointment" ADD COLUMN "publicToken" TEXT;
ALTER TABLE "Appointment" ADD COLUMN "publicCode" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Appointment_publicToken_key" ON "Appointment"("publicToken");
CREATE UNIQUE INDEX "Appointment_publicCode_key" ON "Appointment"("publicCode");
