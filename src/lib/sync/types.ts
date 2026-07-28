import type { EventStatus } from "@prisma/client";

export type NormalizedAttendee = {
  email: string;
  name?: string;
  responseStatus?: string;
};

/** A calendar event as fetched from a provider, translated into our common shape. */
export type NormalizedEvent = {
  externalId: string;
  icalUid?: string | null;
  title: string;
  description?: string | null;
  location?: string | null;
  startAt: Date;
  endAt: Date;
  allDay: boolean;
  timezone: string;
  status: EventStatus;
  organizer?: string | null;
  attendees?: NormalizedAttendee[];
  recurrenceRule?: string | null;
  recurringEventId?: string | null;
  providerUpdatedAt?: Date | null;
  providerEtag?: string | null;
  raw?: unknown;
};

/** Result of fetching one page (or all pages) of changes for a single calendar. */
export type ProviderSyncResult = {
  events: NormalizedEvent[];
  /** externalIds that were deleted/no longer visible (only meaningful for incremental syncs) */
  deletedExternalIds: string[];
  /** opaque cursor to persist on CalendarList.syncCursor for the next incremental sync */
  nextCursor: string | null;
  /** true if the provider invalidated our cursor and this was a full resync */
  wasFullResync: boolean;
};

/** Fields needed to create/update an event on an external provider, from our own DB shape. */
export type WriteEventInput = {
  title: string;
  description?: string | null;
  location?: string | null;
  startAt: Date;
  endAt: Date;
  allDay: boolean;
  timezone?: string | null;
};

/** What a provider hands back after a successful create/update, to persist locally. */
export type ProviderWriteResult = {
  externalId: string;
  icalUid?: string | null;
  providerUpdatedAt?: Date | null;
  providerEtag?: string | null;
};
