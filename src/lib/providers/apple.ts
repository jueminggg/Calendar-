import { DAVClient } from "tsdav";
import ICAL from "ical.js";
import { randomUUID } from "crypto";
import { decrypt } from "@/lib/crypto";
import type { CalendarConnection } from "@prisma/client";
import type { NormalizedEvent, ProviderWriteResult, WriteEventInput } from "@/lib/sync/types";

const DEFAULT_SERVER_URL = "https://caldav.icloud.com";

export function clientForConnection(connection: CalendarConnection): DAVClient {
  if (!connection.caldavUsername || !connection.caldavPassword) {
    throw new Error("Apple connection is missing CalDAV credentials");
  }
  return new DAVClient({
    serverUrl: connection.caldavServerUrl || DEFAULT_SERVER_URL,
    credentials: {
      username: connection.caldavUsername,
      password: decrypt(connection.caldavPassword),
    },
    authMethod: "Basic",
    defaultAccountType: "caldav",
  });
}

/** Verifies credentials work and returns the account label to store, by logging in. */
export async function verifyAppleCredentials(username: string, password: string, serverUrl?: string) {
  const client = new DAVClient({
    serverUrl: serverUrl || DEFAULT_SERVER_URL,
    credentials: { username, password },
    authMethod: "Basic",
    defaultAccountType: "caldav",
  });
  await client.login();
  return client;
}

export async function listAppleCalendars(client: DAVClient) {
  const calendars = await client.fetchCalendars();
  return calendars
    .filter((cal) => !cal.components || cal.components.includes("VEVENT"))
    .map((cal) => ({
      externalId: cal.url,
      name: typeof cal.displayName === "string" ? cal.displayName : cal.url,
      color: cal.calendarColor,
      ctag: cal.ctag,
      raw: cal,
    }));
}

function icalStatusToEventStatus(status: string | null): NormalizedEvent["status"] {
  if (status === "CANCELLED") return "CANCELLED";
  if (status === "TENTATIVE") return "TENTATIVE";
  return "CONFIRMED";
}

/** Parses a raw .ics VEVENT payload into our normalized shape. Does not expand recurrences. */
export function parseIcsEvent(icsData: string, objectUrl: string): NormalizedEvent | null {
  try {
    const jcalData = ICAL.parse(icsData);
    const comp = new ICAL.Component(jcalData);
    const vevent = comp.getFirstSubcomponent("vevent");
    if (!vevent) return null;

    const event = new ICAL.Event(vevent);
    const status = icalStatusToEventStatus(vevent.getFirstPropertyValue("status") as string | null);
    const lastModified = vevent.getFirstPropertyValue("last-modified") as ICAL.Time | null;

    const attendees = vevent.getAllProperties("attendee").map((prop) => {
      const value = String(prop.getFirstValue() ?? "");
      return {
        email: value.replace(/^mailto:/i, ""),
        name: (prop.getParameter("cn") as string) ?? undefined,
        responseStatus: (prop.getParameter("partstat") as string) ?? undefined,
      };
    });

    const organizerProp = vevent.getFirstProperty("organizer");
    const organizer = organizerProp ? String(organizerProp.getFirstValue() ?? "").replace(/^mailto:/i, "") : null;

    return {
      externalId: objectUrl,
      icalUid: event.uid ?? null,
      title: event.summary || "(No title)",
      description: event.description || null,
      location: event.location || null,
      startAt: event.startDate.toJSDate(),
      endAt: event.endDate.toJSDate(),
      allDay: event.startDate.isDate,
      timezone: event.startDate.zone?.tzid || "UTC",
      status,
      organizer,
      attendees,
      recurrenceRule: vevent.getFirstPropertyValue("rrule") ? String(vevent.getFirstPropertyValue("rrule")) : null,
      recurringEventId: null,
      providerUpdatedAt: lastModified ? lastModified.toJSDate() : null,
      providerEtag: null,
      raw: icsData,
    };
  } catch (err) {
    console.error(`Failed to parse CalDAV event at ${objectUrl}`, err);
    return null;
  }
}

function buildIcs(input: WriteEventInput, uid: string): string {
  const calendar = new ICAL.Component(["vcalendar", [], []]);
  calendar.updatePropertyWithValue("prodid", "-//CalSync//EN");
  calendar.updatePropertyWithValue("version", "2.0");

  const vevent = new ICAL.Component("vevent");
  vevent.updatePropertyWithValue("uid", uid);
  vevent.updatePropertyWithValue("summary", input.title);
  if (input.description) vevent.updatePropertyWithValue("description", input.description);
  if (input.location) vevent.updatePropertyWithValue("location", input.location);

  const dtstamp = ICAL.Time.now();
  vevent.updatePropertyWithValue("dtstamp", dtstamp);

  const dtstart = ICAL.Time.fromJSDate(input.startAt, true);
  const dtend = ICAL.Time.fromJSDate(input.endAt, true);
  if (input.allDay) {
    dtstart.isDate = true;
    dtend.isDate = true;
  }
  vevent.updatePropertyWithValue("dtstart", dtstart);
  vevent.updatePropertyWithValue("dtend", dtend);

  calendar.addSubcomponent(vevent);
  return calendar.toString();
}

/** Creates a new event on an iCloud (CalDAV) calendar. */
export async function createAppleEvent(
  client: DAVClient,
  calendarUrl: string,
  input: WriteEventInput,
): Promise<ProviderWriteResult> {
  const uid = randomUUID();
  const filename = `${uid}.ics`;
  const response = await client.createCalendarObject({
    calendar: { url: calendarUrl },
    iCalString: buildIcs(input, uid),
    filename,
  });
  if (!response.ok) throw new Error(`CalDAV create failed: ${response.status} ${await response.text().catch(() => "")}`);

  return {
    externalId: new URL(filename, calendarUrl).toString(),
    icalUid: uid,
    providerUpdatedAt: new Date(),
    providerEtag: response.headers.get("etag"),
  };
}

/** Overwrites an existing iCloud (CalDAV) event in place, keeping the same UID. */
export async function updateAppleEvent(
  client: DAVClient,
  objectUrl: string,
  icalUid: string,
  input: WriteEventInput,
  etag?: string | null,
): Promise<ProviderWriteResult> {
  const response = await client.updateCalendarObject({
    calendarObject: { url: objectUrl, data: buildIcs(input, icalUid), etag: etag ?? undefined },
  });
  if (!response.ok) throw new Error(`CalDAV update failed: ${response.status} ${await response.text().catch(() => "")}`);

  return {
    externalId: objectUrl,
    icalUid,
    providerUpdatedAt: new Date(),
    providerEtag: response.headers.get("etag"),
  };
}

/** Deletes an iCloud (CalDAV) event. Already-gone events (404) are treated as success. */
export async function deleteAppleEvent(client: DAVClient, objectUrl: string, etag?: string | null): Promise<void> {
  const response = await client.deleteCalendarObject({ calendarObject: { url: objectUrl, etag: etag ?? undefined } });
  if (!response.ok && response.status !== 404) {
    throw new Error(`CalDAV delete failed: ${response.status} ${await response.text().catch(() => "")}`);
  }
}
