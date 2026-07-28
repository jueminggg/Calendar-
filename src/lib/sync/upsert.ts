import { prisma } from "@/lib/prisma";
import type { EventSource } from "@prisma/client";
import type { NormalizedEvent, ProviderSyncResult } from "./types";
import { sendPushToUser } from "@/lib/push";

type SyncEventsArgs = {
  userId: string;
  calendarListId: string;
  source: EventSource;
  result: ProviderSyncResult;
  /** Suppress invite/update/cancel notifications, e.g. the first sync right after connecting. */
  isInitialSync: boolean;
};

function hasMeaningfulChange(
  existing: {
    title: string;
    startAt: Date;
    endAt: Date;
    location: string | null;
    status: string;
  },
  incoming: NormalizedEvent,
): boolean {
  return (
    existing.title !== incoming.title ||
    existing.startAt.getTime() !== incoming.startAt.getTime() ||
    existing.endAt.getTime() !== incoming.endAt.getTime() ||
    (existing.location ?? null) !== (incoming.location ?? null) ||
    existing.status !== incoming.status
  );
}

export async function syncCalendarEvents({ userId, calendarListId, source, result, isInitialSync }: SyncEventsArgs) {
  for (const incoming of result.events) {
    const existing = await prisma.event.findUnique({
      where: { calendarListId_externalId: { calendarListId, externalId: incoming.externalId } },
    });

    if (!existing) {
      const created = await prisma.event.create({
        data: {
          userId,
          calendarListId,
          source,
          externalId: incoming.externalId,
          icalUid: incoming.icalUid,
          title: incoming.title,
          description: incoming.description,
          location: incoming.location,
          startAt: incoming.startAt,
          endAt: incoming.endAt,
          allDay: incoming.allDay,
          timezone: incoming.timezone,
          status: incoming.status,
          organizer: incoming.organizer,
          attendees: incoming.attendees as never,
          recurrenceRule: incoming.recurrenceRule,
          recurringEventId: incoming.recurringEventId,
          providerUpdatedAt: incoming.providerUpdatedAt,
          providerEtag: incoming.providerEtag,
          raw: incoming.raw as never,
        },
      });

      if (!isInitialSync && incoming.status !== "CANCELLED") {
        const title = `New event: ${incoming.title}`;
        const body = formatWhen(incoming);
        await prisma.notification.create({ data: { userId, eventId: created.id, type: "INVITE", title, body } });
        await sendPushToUser(userId, { title, body, url: "/" });
      }
      continue;
    }

    const changed = hasMeaningfulChange(existing, incoming);

    await prisma.event.update({
      where: { id: existing.id },
      data: {
        title: incoming.title,
        description: incoming.description,
        location: incoming.location,
        startAt: incoming.startAt,
        endAt: incoming.endAt,
        allDay: incoming.allDay,
        timezone: incoming.timezone,
        status: incoming.status,
        organizer: incoming.organizer,
        attendees: incoming.attendees as never,
        recurrenceRule: incoming.recurrenceRule,
        recurringEventId: incoming.recurringEventId,
        providerUpdatedAt: incoming.providerUpdatedAt,
        providerEtag: incoming.providerEtag,
        raw: incoming.raw as never,
      },
    });

    if (!isInitialSync && changed) {
      const becameCancelled = incoming.status === "CANCELLED" && existing.status !== "CANCELLED";
      const title = becameCancelled ? `Cancelled: ${incoming.title}` : `Updated: ${incoming.title}`;
      const body = formatWhen(incoming);
      await prisma.notification.create({
        data: { userId, eventId: existing.id, type: becameCancelled ? "CANCELLATION" : "UPDATE", title, body },
      });
      await sendPushToUser(userId, { title, body, url: "/" });
    }
  }

  for (const externalId of result.deletedExternalIds) {
    const existing = await prisma.event.findUnique({
      where: { calendarListId_externalId: { calendarListId, externalId } },
    });
    if (!existing || existing.status === "CANCELLED") continue;

    await prisma.event.update({ where: { id: existing.id }, data: { status: "CANCELLED" } });

    if (!isInitialSync) {
      const title = `Cancelled: ${existing.title}`;
      await prisma.notification.create({ data: { userId, eventId: existing.id, type: "CANCELLATION", title } });
      await sendPushToUser(userId, { title, url: "/" });
    }
  }

  await prisma.calendarList.update({
    where: { id: calendarListId },
    data: { syncCursor: result.nextCursor, lastSyncAt: new Date() },
  });
}

function formatWhen(event: NormalizedEvent): string {
  const opts: Intl.DateTimeFormatOptions = event.allDay
    ? { dateStyle: "medium" }
    : { dateStyle: "medium", timeStyle: "short" };
  return new Intl.DateTimeFormat("en-US", opts).format(event.startAt);
}
