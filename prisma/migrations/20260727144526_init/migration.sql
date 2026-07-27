-- CreateEnum
CREATE TYPE "Provider" AS ENUM ('GOOGLE', 'MICROSOFT', 'APPLE');

-- CreateEnum
CREATE TYPE "EventSource" AS ENUM ('GOOGLE', 'MICROSOFT', 'APPLE', 'NATIVE');

-- CreateEnum
CREATE TYPE "ConnectionStatus" AS ENUM ('ACTIVE', 'ERROR', 'DISCONNECTED');

-- CreateEnum
CREATE TYPE "EventStatus" AS ENUM ('CONFIRMED', 'TENTATIVE', 'CANCELLED');

-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('INVITE', 'UPDATE', 'CANCELLATION', 'CONNECTION_ERROR');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "passwordHash" TEXT NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CalendarConnection" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "provider" "Provider" NOT NULL,
    "label" TEXT NOT NULL,
    "status" "ConnectionStatus" NOT NULL DEFAULT 'ACTIVE',
    "lastSyncAt" TIMESTAMP(3),
    "lastError" TEXT,
    "accessToken" TEXT,
    "refreshToken" TEXT,
    "tokenExpiresAt" TIMESTAMP(3),
    "scope" TEXT,
    "caldavUsername" TEXT,
    "caldavPassword" TEXT,
    "caldavServerUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CalendarConnection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CalendarList" (
    "id" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "syncCursor" TEXT,
    "lastSyncAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CalendarList_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Event" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "calendarListId" TEXT,
    "source" "EventSource" NOT NULL,
    "externalId" TEXT,
    "icalUid" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "location" TEXT,
    "startAt" TIMESTAMP(3) NOT NULL,
    "endAt" TIMESTAMP(3) NOT NULL,
    "allDay" BOOLEAN NOT NULL DEFAULT false,
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "status" "EventStatus" NOT NULL DEFAULT 'CONFIRMED',
    "organizer" TEXT,
    "attendees" JSONB,
    "recurrenceRule" TEXT,
    "recurringEventId" TEXT,
    "providerUpdatedAt" TIMESTAMP(3),
    "providerEtag" TEXT,
    "raw" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebhookChannel" (
    "id" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "provider" "Provider" NOT NULL,
    "channelId" TEXT NOT NULL,
    "resourceId" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WebhookChannel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "eventId" TEXT,
    "type" "NotificationType" NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT,
    "read" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "CalendarConnection_userId_idx" ON "CalendarConnection"("userId");

-- CreateIndex
CREATE INDEX "CalendarList_connectionId_idx" ON "CalendarList"("connectionId");

-- CreateIndex
CREATE UNIQUE INDEX "CalendarList_connectionId_externalId_key" ON "CalendarList"("connectionId", "externalId");

-- CreateIndex
CREATE INDEX "Event_userId_startAt_idx" ON "Event"("userId", "startAt");

-- CreateIndex
CREATE INDEX "Event_icalUid_idx" ON "Event"("icalUid");

-- CreateIndex
CREATE UNIQUE INDEX "Event_calendarListId_externalId_key" ON "Event"("calendarListId", "externalId");

-- CreateIndex
CREATE INDEX "WebhookChannel_connectionId_idx" ON "WebhookChannel"("connectionId");

-- CreateIndex
CREATE INDEX "Notification_userId_read_idx" ON "Notification"("userId", "read");

-- AddForeignKey
ALTER TABLE "CalendarConnection" ADD CONSTRAINT "CalendarConnection_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CalendarList" ADD CONSTRAINT "CalendarList_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "CalendarConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Event" ADD CONSTRAINT "Event_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Event" ADD CONSTRAINT "Event_calendarListId_fkey" FOREIGN KEY ("calendarListId") REFERENCES "CalendarList"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WebhookChannel" ADD CONSTRAINT "WebhookChannel_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "CalendarConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE SET NULL ON UPDATE CASCADE;
