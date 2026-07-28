import { prisma } from "@/lib/prisma";
import { syncGoogleConnection } from "./google";
import { syncMicrosoftConnection } from "./microsoft";
import { syncAppleConnection } from "./apple";
import { clientForConnection as googleClient, watchGoogleCalendar } from "@/lib/providers/google";
import { getMicrosoftAccessToken, subscribeMicrosoftCalendar } from "@/lib/providers/microsoft";
import { randomBytes } from "crypto";

export async function syncConnection(connectionId: string, isInitialSync = false) {
  const connection = await prisma.calendarConnection.findUniqueOrThrow({ where: { id: connectionId } });
  switch (connection.provider) {
    case "GOOGLE":
      return syncGoogleConnection(connectionId, isInitialSync);
    case "MICROSOFT":
      return syncMicrosoftConnection(connectionId, isInitialSync);
    case "APPLE":
      return syncAppleConnection(connectionId, isInitialSync);
  }
}

/** Polls every connected calendar. Safety net that works even without webhooks configured. */
export async function syncAllConnections() {
  const connections = await prisma.calendarConnection.findMany({
    where: { status: { in: ["ACTIVE", "ERROR"] } },
  });

  const results = await Promise.allSettled(connections.map((c) => syncConnection(c.id)));

  return {
    total: connections.length,
    failed: results.filter((r) => r.status === "rejected").length,
  };
}

/** Renews Google/Microsoft push-notification channels that are missing or about to expire. */
export async function renewWebhooks() {
  if (!process.env.APP_URL?.trim()) return;

  const soon = new Date(Date.now() + 24 * 60 * 60 * 1000);

  const googleCalendars = await prisma.calendarList.findMany({
    where: {
      enabled: true,
      connection: { provider: "GOOGLE", status: "ACTIVE" },
    },
    include: { connection: true },
  });

  for (const cal of googleCalendars) {
    const existing = await prisma.webhookChannel.findFirst({
      where: { connectionId: cal.connectionId, provider: "GOOGLE" },
      orderBy: { expiresAt: "desc" },
    });
    if (existing && existing.expiresAt > soon) continue;

    try {
      const client = googleClient(cal.connection);
      const channelId = randomBytes(16).toString("hex");
      const watch = await watchGoogleCalendar(client, cal.externalId, channelId);
      if (watch?.expiration) {
        await prisma.webhookChannel.create({
          data: {
            connectionId: cal.connectionId,
            provider: "GOOGLE",
            channelId,
            resourceId: watch.resourceId ?? undefined,
            expiresAt: new Date(Number(watch.expiration)),
          },
        });
      }
    } catch (err) {
      console.error(`Failed to renew Google watch channel for calendar ${cal.id}`, err);
    }
  }

  const microsoftCalendars = await prisma.calendarList.findMany({
    where: {
      enabled: true,
      connection: { provider: "MICROSOFT", status: "ACTIVE" },
    },
    include: { connection: true },
  });

  for (const cal of microsoftCalendars) {
    const existing = await prisma.webhookChannel.findFirst({
      where: { connectionId: cal.connectionId, provider: "MICROSOFT" },
      orderBy: { expiresAt: "desc" },
    });
    if (existing && existing.expiresAt > soon) continue;

    try {
      const accessToken = await getMicrosoftAccessToken(cal.connection);
      const sub = await subscribeMicrosoftCalendar(accessToken, cal.externalId);
      if (sub?.id && sub?.expirationDateTime) {
        await prisma.webhookChannel.create({
          data: {
            connectionId: cal.connectionId,
            provider: "MICROSOFT",
            channelId: sub.id,
            expiresAt: new Date(sub.expirationDateTime),
          },
        });
      }
    } catch (err) {
      console.error(`Failed to renew Microsoft subscription for calendar ${cal.id}`, err);
    }
  }
}
