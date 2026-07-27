import { prisma } from "@/lib/prisma";
import { getMicrosoftAccessToken, fetchMicrosoftEvents } from "@/lib/providers/microsoft";
import { syncCalendarEvents } from "./upsert";

export async function syncMicrosoftConnection(connectionId: string, isInitialSync = false) {
  const connection = await prisma.calendarConnection.findUniqueOrThrow({
    where: { id: connectionId },
    include: { calendars: { where: { enabled: true } } },
  });

  try {
    const accessToken = await getMicrosoftAccessToken(connection);

    for (const cal of connection.calendars) {
      const result = await fetchMicrosoftEvents(accessToken, cal.externalId, cal.syncCursor);
      await syncCalendarEvents({
        userId: connection.userId,
        calendarListId: cal.id,
        source: "MICROSOFT",
        result,
        isInitialSync: isInitialSync || result.wasFullResync,
      });
    }

    await prisma.calendarConnection.update({
      where: { id: connection.id },
      data: { status: "ACTIVE", lastError: null, lastSyncAt: new Date() },
    });
  } catch (err) {
    await prisma.calendarConnection.update({
      where: { id: connection.id },
      data: { status: "ERROR", lastError: err instanceof Error ? err.message : String(err) },
    });
    throw err;
  }
}
