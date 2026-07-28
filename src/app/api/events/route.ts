import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { createEventOnProvider } from "@/lib/sync/write";

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = request.nextUrl;
  const from = searchParams.get("from");
  const to = searchParams.get("to");
  if (!from || !to) {
    return NextResponse.json({ error: "from and to query params are required (ISO dates)" }, { status: 400 });
  }

  const events = await prisma.event.findMany({
    where: {
      userId: session.userId,
      status: { not: "CANCELLED" },
      startAt: { lte: new Date(to) },
      endAt: { gte: new Date(from) },
    },
    include: { calendarList: { include: { connection: true } } },
    orderBy: { startAt: "asc" },
  });

  return NextResponse.json({
    events: events.map((e) => ({
      id: e.id,
      source: e.source,
      title: e.title,
      description: e.description,
      location: e.location,
      startAt: e.startAt,
      endAt: e.endAt,
      allDay: e.allDay,
      status: e.status,
      organizer: e.organizer,
      attendees: e.attendees,
      calendarName: e.calendarList?.name ?? "My Calendar",
      calendarColor: e.calendarList?.color ?? null,
      connectionLabel: e.calendarList?.connection.label ?? null,
      editable: true,
    })),
  });
}

const NATIVE_TARGET = "native";

const createSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional(),
  location: z.string().optional(),
  startAt: z.string(),
  endAt: z.string(),
  allDay: z.boolean().optional(),
  timezone: z.string().optional(),
  // Which calendars to create this event on: "native" for a plain in-app-only
  // copy, or a CalendarList id to also create it on that connected calendar
  // (Google/Outlook/iCloud). Can include several — the same event gets
  // created on each one. Defaults to native-only when omitted.
  targets: z.array(z.string()).min(1).optional(),
});

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
  }
  const data = parsed.data;
  const targets = data.targets && data.targets.length > 0 ? data.targets : [NATIVE_TARGET];

  const writeInput = {
    title: data.title,
    description: data.description ?? null,
    location: data.location ?? null,
    startAt: new Date(data.startAt),
    endAt: new Date(data.endAt),
    allDay: data.allDay ?? false,
    timezone: data.timezone ?? "UTC",
  };

  const calendarIds = targets.filter((t) => t !== NATIVE_TARGET);
  const calendars = calendarIds.length
    ? await prisma.calendarList.findMany({ where: { id: { in: calendarIds } }, include: { connection: true } })
    : [];

  const missing = calendarIds.filter((id) => !calendars.some((c) => c.id === id));
  if (missing.length > 0 || calendars.some((c) => c.connection.userId !== session.userId)) {
    return NextResponse.json({ error: "One or more selected calendars weren't found." }, { status: 404 });
  }

  const createdEvents = [];
  const errors: string[] = [];

  if (targets.includes(NATIVE_TARGET)) {
    const event = await prisma.event.create({
      data: {
        userId: session.userId,
        source: "NATIVE",
        title: writeInput.title,
        description: writeInput.description,
        location: writeInput.location,
        startAt: writeInput.startAt,
        endAt: writeInput.endAt,
        allDay: writeInput.allDay,
        timezone: writeInput.timezone,
        status: "CONFIRMED",
      },
    });
    createdEvents.push(event);
  }

  for (const calendar of calendars) {
    try {
      const result = await createEventOnProvider(calendar, writeInput);
      const event = await prisma.event.create({
        data: {
          userId: session.userId,
          calendarListId: calendar.id,
          source: calendar.connection.provider,
          externalId: result.externalId,
          icalUid: result.icalUid,
          title: writeInput.title,
          description: writeInput.description,
          location: writeInput.location,
          startAt: writeInput.startAt,
          endAt: writeInput.endAt,
          allDay: writeInput.allDay,
          timezone: writeInput.timezone,
          status: "CONFIRMED",
          providerUpdatedAt: result.providerUpdatedAt,
          providerEtag: result.providerEtag,
        },
      });
      createdEvents.push(event);
    } catch (err) {
      console.error(`Failed to create event on calendar ${calendar.id}`, err);
      const message = err instanceof Error ? err.message : "Couldn't create the event on that calendar.";
      errors.push(`${calendar.name}: ${message}`);
    }
  }

  if (createdEvents.length === 0) {
    return NextResponse.json({ error: errors.join("; ") || "Couldn't create the event." }, { status: 502 });
  }

  return NextResponse.json({ events: createdEvents, errors: errors.length ? errors : undefined });
}
