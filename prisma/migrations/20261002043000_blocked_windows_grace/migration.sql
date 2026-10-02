ALTER TABLE "Branch" ALTER COLUMN "graceMinutes" SET DEFAULT 10;
UPDATE "Branch" SET "graceMinutes" = 10;

CREATE TABLE "BlockedWindow" (
    "id" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "barberId" TEXT,
    "date" TEXT NOT NULL,
    "startMin" INTEGER NOT NULL,
    "endMin" INTEGER NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BlockedWindow_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "BlockedWindow_date_idx" ON "BlockedWindow"("date");

ALTER TABLE "BlockedWindow" ADD CONSTRAINT "BlockedWindow_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BlockedWindow" ADD CONSTRAINT "BlockedWindow_barberId_fkey" FOREIGN KEY ("barberId") REFERENCES "Barber"("id") ON DELETE CASCADE ON UPDATE CASCADE;
