-- AlterTable
ALTER TABLE "CalendarConnection" ADD COLUMN     "providerAccountId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "CalendarConnection_userId_provider_label_key" ON "CalendarConnection"("userId", "provider", "label");

