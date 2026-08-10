ALTER TABLE "divisiones" ADD COLUMN "canchaUnicaId" TEXT;

CREATE INDEX "divisiones_canchaUnicaId_idx" ON "divisiones"("canchaUnicaId");

ALTER TABLE "divisiones"
ADD CONSTRAINT "divisiones_canchaUnicaId_fkey"
FOREIGN KEY ("canchaUnicaId") REFERENCES "ligas_canchas"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
