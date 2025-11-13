/*
  Warnings:

  - A unique constraint covering the columns `[paymentIntentId]` on the table `PaymentLink` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "PaymentLink" ADD COLUMN     "paymentIntentId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "PaymentLink_paymentIntentId_key" ON "PaymentLink"("paymentIntentId");
