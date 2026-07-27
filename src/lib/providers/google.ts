import { google } from "googleapis";
import type { calendar_v3 } from "googleapis";
import { prisma } from "@/lib/prisma";
import { encrypt, decrypt } from "@/lib/crypto";
import type { CalendarConnection } from "@prisma/client";
import type { NormalizedEvent, ProviderSyncResult } from "@/lib/sync/types";

// Derived from the constructor we actually use, rather than imported from
// google-auth-library directly, to avoid a duplicate-package type mismatch
// with the nested copy googleapis-common depends on internally.
export type OAuth2Client = InstanceType<typeof google.auth.OAuth2>;

export const GOOGLE_SCOPES = [
  "openid",
  "email",
  "https://www.googleapis.com/auth/calendar.readonly",
  "https://www.googleapis.com/auth/calendar.events",
];

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} environment variable is not set`);
  return value;
}

export function getRedirectUri(): string {
  const base = requireEnv("APP_URL");
  return `${base}/api/connections/google/callback`;
}

export function createOAuthClient(): OAuth2Client {
  return new google.auth.OAuth2(
    requireEnv("GOOGLE_CLIENT_ID"),
    requireEnv("GOOGLE_CLIENT_SECRET"),
    getRedirectUri(),
  );
}

export function getGoogleAuthUrl(state: string): string {
  const client = createOAuthClient();
  return client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent", // ensures we always get a refresh_token, even on reconnect
    scope: GOOGLE_SCOPES,
    state,
  });
}

/**
 * Builds an OAuth2Client for a stored connection, decrypting its refresh token and
 * transparently persisting a rotated access token back to the database when Google
 * mints a new one.
 */
export function clientForConnection(connection: CalendarConnection): OAuth2Client {
  const client = createOAuthClient();
  client.setCredentials({
    access_token: connection.accessToken ? decrypt(connection.accessToken) : undefined,
    refresh_token: connection.refreshToken ? decrypt(connection.refreshToken) : undefined,
    expiry_date: connection.tokenExpiresAt?.getTime(),
  });

  client.on("tokens", (tokens) => {
    void prisma.calendarConnection
      .update({
        where: { id: connection.id },
        data: {
          accessToken: tokens.access_token ? encrypt(tokens.access_token) : undefined,
          refreshToken: tokens.refresh_token ? encrypt(tokens.refresh_token) : undefined,
          tokenExpiresAt: tokens.expiry_date ? new Date(tokens.expiry_date) : undefined,
        },
      })
      .catch((err) => console.error("Failed to persist refreshed Google tokens", err));
  });

  return client;
}

export async function fetchGoogleAccountEmail(client: OAuth2Client): Promise<string> {
  const oauth2 = google.oauth2({ auth: client, version: "v2" });
  const { data } = await oauth2.userinfo.get();
  if (!data.email) throw new Error("Google account has no email address");
  return data.email;
}

export async function listGoogleCalendars(client: OAuth2Client) {
  const calendar = google.calendar({ version: "v3", auth: client });
  const { data } = await calendar.calendarList.list();
  return (data.items ?? []).map((item) => ({
    externalId: item.id!,
    name: item.summaryOverride ?? item.summary ?? item.id!,
    color: item.backgroundColor ?? undefined,
    isPrimary: Boolean(item.primary),
  }));
}

function normalizeGoogleEvent(event: calendar_v3.Schema$Event): NormalizedEvent | null {
  if (!event.id) return null;

  const start = event.start?.dateTime ?? event.start?.date;
  const end = event.end?.dateTime ?? event.end?.date;
  if (!start || !end) return null;

  const allDay = Boolean(event.start?.date && !event.start?.dateTime);

  return {
    externalId: event.id,
    icalUid: event.iCalUID ?? null,
    title: event.summary ?? "(No title)",
    description: event.description ?? null,
    location: event.location ?? null,
    startAt: new Date(start),
    endAt: new Date(end),
    allDay,
    timezone: event.start?.timeZone ?? "UTC",
    status: event.status === "cancelled" ? "CANCELLED" : event.status === "tentative" ? "TENTATIVE" : "CONFIRMED",
    organizer: event.organizer?.email ?? null,
    attendees: (event.attendees ?? []).map((a) => ({
      email: a.email ?? "",
      name: a.displayName ?? undefined,
      responseStatus: a.responseStatus ?? undefined,
    })),
    recurrenceRule: event.recurrence?.join("\n") ?? null,
    recurringEventId: event.recurringEventId ?? null,
    providerUpdatedAt: event.updated ? new Date(event.updated) : null,
    providerEtag: event.etag ?? null,
    raw: event as unknown,
  };
}

/**
 * Fetches changes for one Google calendar since `syncCursor` (a Google sync token),
 * or does a bounded initial fetch (events from 30 days ago onward) when there is no
 * cursor yet. Handles Google's "410 Gone / token expired" by falling back to a full
 * resync.
 */
export async function fetchGoogleEvents(
  client: OAuth2Client,
  calendarId: string,
  syncCursor: string | null,
): Promise<ProviderSyncResult> {
  const calendar = google.calendar({ version: "v3", auth: client });
  const events: NormalizedEvent[] = [];
  const deletedExternalIds: string[] = [];
  let pageToken: string | undefined;
  let nextSyncToken: string | undefined;
  let wasFullResync = false;

  const doFetch = async (useSyncToken: string | null): Promise<void> => {
    events.length = 0;
    deletedExternalIds.length = 0;
    pageToken = undefined;
    do {
      const res = await calendar.events.list({
        calendarId,
        syncToken: useSyncToken ?? undefined,
        timeMin: useSyncToken ? undefined : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
        singleEvents: true,
        showDeleted: true,
        maxResults: 250,
        pageToken,
      });
      const data: calendar_v3.Schema$Events = res.data;

      for (const item of data.items ?? []) {
        if (item.status === "cancelled") {
          if (item.id) deletedExternalIds.push(item.id);
          continue;
        }
        const normalized = normalizeGoogleEvent(item);
        if (normalized) events.push(normalized);
      }

      pageToken = data.nextPageToken ?? undefined;
      if (data.nextSyncToken) nextSyncToken = data.nextSyncToken;
    } while (pageToken);
  };

  try {
    await doFetch(syncCursor);
  } catch (err: unknown) {
    const status = (err as { code?: number; response?: { status?: number } })?.code ??
      (err as { response?: { status?: number } })?.response?.status;
    if (status === 410 && syncCursor) {
      // Sync token expired/invalid: fall back to a full resync from scratch.
      wasFullResync = true;
      await doFetch(null);
    } else {
      throw err;
    }
  }

  return {
    events,
    deletedExternalIds,
    nextCursor: nextSyncToken ?? syncCursor,
    wasFullResync,
  };
}

/** Registers a push-notification channel (Google "watch") for a calendar, if configured. */
export async function watchGoogleCalendar(client: OAuth2Client, calendarId: string, channelId: string) {
  const webhookUrl = process.env.APP_URL ? `${process.env.APP_URL}/api/webhooks/google` : null;
  if (!webhookUrl) return null;

  const calendar = google.calendar({ version: "v3", auth: client });
  const { data } = await calendar.events.watch({
    calendarId,
    requestBody: {
      id: channelId,
      type: "web_hook",
      address: webhookUrl,
    },
  });
  return data;
}
