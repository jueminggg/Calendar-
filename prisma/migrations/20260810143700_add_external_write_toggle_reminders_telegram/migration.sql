
-- AlterTable
ALTER TABLE "Event" ADD COLUMN     "reminderMinutesBefore" INTEGER,
ADD COLUMN     "reminderSentAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "externalWriteEnabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "lastTelegramEveningAgendaSentAt" TIMESTAMP(3),
ADD COLUMN     "lastTelegramMorningAgendaSentAt" TIMESTAMP(3),
ADD COLUMN     "telegramChatId" TEXT,
ADD COLUMN     "telegramEveningAgendaEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "telegramEveningAgendaTime" TEXT NOT NULL DEFAULT '21:00',
ADD COLUMN     "telegramLinkCode" TEXT,
ADD COLUMN     "telegramLinkCodeExpiresAt" TIMESTAMP(3),
ADD COLUMN     "telegramMorningAgendaEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "telegramMorningAgendaTime" TEXT NOT NULL DEFAULT '08:00';

-- CreateIndex
CREATE UNIQUE INDEX "User_telegramChatId_key" ON "User"("telegramChatId");

-- CreateIndex
CREATE UNIQUE INDEX "User_telegramLinkCode_key" ON "User"("telegramLinkCode");

