-- AlterTable
ALTER TABLE "CheckoutSession" ADD COLUMN     "sessionTokenHash" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "CheckoutSession_sessionTokenHash_key" ON "CheckoutSession"("sessionTokenHash");

