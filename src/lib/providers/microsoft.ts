import { ConfidentialClientApplication, type AccountInfo } from "@azure/msal-node";
import { prisma } from "@/lib/prisma";
import { encrypt, decrypt } from "@/lib/crypto";
import type { CalendarConnection } from "@/generated/prisma/client";
import type { NormalizedEvent, ProviderSyncResult } from "@/lib/sync/types";

export const MICROSOFT_SCOPES = ["openid", "email", "profile", "offline_access", "Calendars.Read"];

const GRAPH_BASE = "https://graph.microsoft.com/v1.0";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} environment variable is not set`);
  return value;
}

export function getRedirectUri(): string {
  return `${requireEnv("APP_URL")}/api/connections/microsoft/callback`;
}

export function createMsalClient(): ConfidentialClientApplication {
  return new ConfidentialClientApplication({
    auth: {
      clientId: requireEnv("MICROSOFT_CLIENT_ID"),
      clientSecret: requireEnv("MICROSOFT_CLIENT_SECRET"),
      authority: `https://login.microsoftonline.com/${process.env.MICROSOFT_TENANT_ID ?? "common"}`,
    },
  });
}

export async function getMicrosoftAuthUrl(state: string): Promise<string> {
  const client = createMsalClient();
  return client.getAuthCodeUrl({
    scopes: MICROSOFT_SCOPES,
    redirectUri: getRedirectUri(),
    state,
  });
}

/**
 * Exchanges an auth code for tokens and returns everything we need to persist:
 * the account (for future silent refreshes) and the serialized MSAL cache
 * (which holds the actual refresh token internally).
 */
export async function exchangeMicrosoftCode(code: string) {
  const client = createMsalClient();
  const result = await client.acquireTokenByCode({
    code,
    scopes: MICROSOFT_SCOPES,
    redirectUri: getRedirectUri(),
  });
  if (!result?.account) throw new Error("Microsoft sign-in did not return an account");

  return {
    account: result.account,
    accessToken: result.accessToken,
    expiresOn: result.expiresOn,
    serializedCache: client.getTokenCache().serialize(),
  };
}

/**
 * Returns a valid Graph access token for a stored connection, refreshing via
 * the cached MSAL refresh token if needed, and persisting any rotated cache.
 */
export async function getMicrosoftAccessToken(connection: CalendarConnection): Promise<string> {
  if (!connection.refreshToken || !connection.providerAccountId) {
    throw new Error("Microsoft connection is missing its token cache");
  }

  const client = createMsalClient();
  await client.getTokenCache().deserialize(decrypt(connection.refreshToken));

  const accounts = await client.getTokenCache().getAllAccounts();
  const account = accounts.find((a) => a.homeAccountId === connection.providerAccountId) as
    | AccountInfo
    | undefined;
  if (!account) throw new Error("Microsoft account not found in token cache");

  const result = await client.acquireTokenSilent({ account, scopes: MICROSOFT_SCOPES });
  if (!result) throw new Error("Failed to silently refresh Microsoft token");

  void prisma.calendarConnection
    .update({
      where: { id: connection.id },
      data: {
        refreshToken: encrypt(client.getTokenCache().serialize()),
        tokenExpiresAt: result.expiresOn ?? undefined,
      },
    })
    .catch((err) => console.error("Failed to persist refreshed Microsoft token cache", err));

  return result.accessToken;
}

async function graphFetch(accessToken: string, path: string) {
  const res = await fetch(path.startsWith("http") ? path : `${GRAPH_BASE}${path}`, {
    headers: { Authorization: `Bearer ${accessToken}`, Prefer: 'outlook.timezone="UTC"' },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Graph API ${res.status}: ${body}`);
  }
  return res.json();
}

export async function fetchMicrosoftAccountEmail(accessToken: string): Promise<string> {
  const me = await graphFetch(accessToken, "/me?$select=mail,userPrincipalName");
  const email = me.mail ?? me.userPrincipalName;
  if (!email) throw new Error("Microsoft account has no email address");
  return email;
}

export async function listMicrosoftCalendars(accessToken: string) {
  const data = await graphFetch(accessToken, "/me/calendars?$select=id,name,color,isDefaultCalendar");
  return (data.value as Array<Record<string, unknown>>).map((cal) => ({
    externalId: cal.id as string,
    name: (cal.name as string) ?? "Calendar",
    color: undefined,
    isPrimary: Boolean(cal.isDefaultCalendar),
  }));
}

type GraphEvent = {
  id: string;
  subject?: string;
  bodyPreview?: string;
  location?: { displayName?: string };
  start?: { dateTime?: string; timeZone?: string };
  end?: { dateTime?: string; timeZone?: string };
  isAllDay?: boolean;
  isCancelled?: boolean;
  showAs?: string;
  organizer?: { emailAddress?: { address?: string } };
  attendees?: Array<{ emailAddress?: { address?: string; name?: string }; status?: { response?: string } }>;
  seriesMasterId?: string;
  recurrence?: unknown;
  lastModifiedDateTime?: string;
  iCalUId?: string;
  "@removed"?: { reason?: string };
};

function normalizeMicrosoftEvent(event: GraphEvent): NormalizedEvent | null {
  if (!event.start?.dateTime || !event.end?.dateTime) return null;

  return {
    externalId: event.id,
    icalUid: event.iCalUId ?? null,
    title: event.subject ?? "(No title)",
    description: event.bodyPreview ?? null,
    location: event.location?.displayName ?? null,
    // Requests set Prefer: outlook.timezone="UTC", so Graph returns naive
    // datetimes that are already in UTC; append Z to parse them correctly.
    startAt: new Date(`${event.start.dateTime}Z`),
    endAt: new Date(`${event.end.dateTime}Z`),
    allDay: Boolean(event.isAllDay),
    timezone: event.start.timeZone ?? "UTC",
    status: event.isCancelled ? "CANCELLED" : event.showAs === "tentative" ? "TENTATIVE" : "CONFIRMED",
    organizer: event.organizer?.emailAddress?.address ?? null,
    attendees: (event.attendees ?? []).map((a) => ({
      email: a.emailAddress?.address ?? "",
      name: a.emailAddress?.name,
      responseStatus: a.status?.response,
    })),
    recurrenceRule: event.recurrence ? JSON.stringify(event.recurrence) : null,
    recurringEventId: event.seriesMasterId ?? null,
    providerUpdatedAt: event.lastModifiedDateTime ? new Date(event.lastModifiedDateTime) : null,
    providerEtag: null,
    raw: event as unknown,
  };
}

/**
 * Fetches changes for one Outlook calendar using Graph's delta query, or does a
 * bounded initial fetch when there is no cursor yet.
 */
export async function fetchMicrosoftEvents(
  accessToken: string,
  calendarId: string,
  deltaCursor: string | null,
): Promise<ProviderSyncResult> {
  const events: NormalizedEvent[] = [];
  const deletedExternalIds: string[] = [];
  let wasFullResync = false;

  const startUrl = deltaCursor
    ? deltaCursor
    : (() => {
        const startDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
        return `${GRAPH_BASE}/me/calendars/${calendarId}/calendarView/delta?startDateTime=${startDate}&endDateTime=2100-01-01T00:00:00Z`;
      })();

  if (!deltaCursor) wasFullResync = true;

  let nextLink: string | undefined = startUrl;
  let nextCursor: string | null = deltaCursor;

  try {
    while (nextLink) {
      const data: { value: GraphEvent[]; "@odata.nextLink"?: string; "@odata.deltaLink"?: string } =
        await graphFetch(accessToken, nextLink);

      for (const item of data.value ?? []) {
        if (item["@removed"] || item.isCancelled) {
          deletedExternalIds.push(item.id);
          continue;
        }
        const normalized = normalizeMicrosoftEvent(item);
        if (normalized) events.push(normalized);
      }

      nextLink = data["@odata.nextLink"];
      if (data["@odata.deltaLink"]) nextCursor = data["@odata.deltaLink"];
    }
  } catch (err) {
    if (deltaCursor) {
      // Delta cursor likely expired; fall back to a full resync.
      wasFullResync = true;
      return fetchMicrosoftEvents(accessToken, calendarId, null);
    }
    throw err;
  }

  return { events, deletedExternalIds, nextCursor, wasFullResync };
}

/** Registers a Microsoft Graph change subscription (webhook) for a calendar, if configured. */
export async function subscribeMicrosoftCalendar(accessToken: string, calendarId: string) {
  const webhookUrl = process.env.APP_URL ? `${process.env.APP_URL}/api/webhooks/microsoft` : null;
  if (!webhookUrl) return null;

  const res = await fetch(`${GRAPH_BASE}/subscriptions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      changeType: "created,updated,deleted",
      notificationUrl: webhookUrl,
      resource: `/me/calendars/${calendarId}/events`,
      expirationDateTime: new Date(Date.now() + 60 * 60 * 1000 * 24 * 2).toISOString(),
      clientState: process.env.MICROSOFT_WEBHOOK_SECRET ?? "",
    }),
  });
  if (!res.ok) {
    console.error("Failed to create Microsoft Graph subscription", await res.text().catch(() => ""));
    return null;
  }
  return res.json();
}
