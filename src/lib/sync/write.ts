import type { CalendarConnection, CalendarList } from "@prisma/client";
import { clientForConnection as googleClientFor, createGoogleEvent, updateGoogleEvent, deleteGoogleEvent } from "@/lib/providers/google";
import { getMicrosoftAccessToken, createMicrosoftEvent, updateMicrosoftEvent, deleteMicrosoftEvent } from "@/lib/providers/microsoft";
import { clientForConnection as appleClientFor, createAppleEvent, updateAppleEvent, deleteAppleEvent } from "@/lib/providers/apple";
import type { ProviderWriteResult, WriteEventInput } from "./types";

export type CalendarWithConnection = CalendarList & { connection: CalendarConnection };

/** Creates a new event directly on whichever provider owns this calendar. */
export async function createEventOnProvider(
  calendar: CalendarWithConnection,
  input: WriteEventInput,
): Promise<ProviderWriteResult> {
  switch (calendar.connection.provider) {
    case "GOOGLE":
      return createGoogleEvent(googleClientFor(calendar.connection), calendar.externalId, input);
    case "MICROSOFT":
      return createMicrosoftEvent(await getMicrosoftAccessToken(calendar.connection), calendar.externalId, input);
    case "APPLE":
      return createAppleEvent(appleClientFor(calendar.connection), calendar.externalId, input);
  }
}

/** Overwrites an existing event on whichever provider owns this calendar. */
export async function updateEventOnProvider(
  calendar: CalendarWithConnection,
  event: { externalId: string; icalUid: string | null; providerEtag: string | null },
  input: WriteEventInput,
): Promise<ProviderWriteResult> {
  switch (calendar.connection.provider) {
    case "GOOGLE":
      return updateGoogleEvent(googleClientFor(calendar.connection), calendar.externalId, event.externalId, input);
    case "MICROSOFT":
      return updateMicrosoftEvent(await getMicrosoftAccessToken(calendar.connection), event.externalId, input);
    case "APPLE":
      return updateAppleEvent(
        appleClientFor(calendar.connection),
        event.externalId,
        event.icalUid ?? crypto.randomUUID(),
        input,
        event.providerEtag,
      );
  }
}

/** Deletes an event from whichever provider owns this calendar. */
export async function deleteEventOnProvider(
  calendar: CalendarWithConnection,
  event: { externalId: string; providerEtag: string | null },
): Promise<void> {
  switch (calendar.connection.provider) {
    case "GOOGLE":
      return deleteGoogleEvent(googleClientFor(calendar.connection), calendar.externalId, event.externalId);
    case "MICROSOFT":
      return deleteMicrosoftEvent(await getMicrosoftAccessToken(calendar.connection), event.externalId);
    case "APPLE":
      return deleteAppleEvent(appleClientFor(calendar.connection), event.externalId, event.providerEtag);
  }
}
