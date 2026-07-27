import { prisma } from "@/lib/prisma";
import { clientForConnection, listAppleCalendars, parseIcsEvent } from "@/lib/providers/apple";
import { syncCalendarEvents } from "./upsert";
import type { NormalizedEvent } from "./types";

// CalDAV has no incremental delta API we rely on here, so each sync re-fetches
// everything in this window and diffs it against what we already have stored.
const WINDOW_PAST_DAYS = 30;
const WINDOW_FUTURE_DAYS = 365;

export async function syncAppleConnection(connectionId: string, isInitialSync = false) {
  const connection = await prisma.calendarConnection.findUniqueOrThrow({
    where: { id: connectionId },
    include: { calendars: { where: { enabled: true } } },
  });

  try {
    const client = clientForConnection(connection);
    await client.login();

    const remoteCalendars = await listAppleCalendars(client);

    for (const cal of connection.calendars) {
      const remote = remoteCalendars.find((r) => r.externalId === cal.externalId);
      if (!remote) continue;

      // Skip calendars whose ctag hasn't changed since last time - nothing to do.
      if (!isInitialSync && remote.ctag && remote.ctag === cal.syncCursor) continue;

      const start = new Date(Date.now() - WINDOW_PAST_DAYS * 24 * 60 * 60 * 1000);
      const end = new Date(Date.now() + WINDOW_FUTURE_DAYS * 24 * 60 * 60 * 1000);

      const objects = await client.fetchCalendarObjects({
        calendar: remote.raw,
        timeRange: { start: start.toISOString(), end: end.toISOString() },
      });

      const events: NormalizedEvent[] = [];
      for (const obj of objects) {
        if (!obj.data) continue;
        const normalized = parseIcsEvent(obj.data, obj.url);
        if (normalized) events.push(normalized);
      }

      const fetchedIds = new Set(events.map((e) => e.externalId));
      const existing = await prisma.event.findMany({
        where: { calendarListId: cal.id, startAt: { gte: start, lte: end } },
        select: { externalId: true },
      });
      const deletedExternalIds = existing
        .map((e) => e.externalId)
        .filter((id): id is string => id != null && !fetchedIds.has(id));

      await syncCalendarEvents({
        userId: connection.userId,
        calendarListId: cal.id,
        source: "APPLE",
        result: {
          events,
          deletedExternalIds,
          nextCursor: remote.ctag ?? null,
          wasFullResync: true,
        },
        isInitialSync,
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
