import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { randomUUID } from "crypto";
import { getSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { createEventOnProvider } from "@/lib/sync/write";
import { expandOccurrences, buildRecurrenceRule, MAX_OCCURRENCES } from "@/lib/recurrence";

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = request.nextUrl;
  const from = searchParams.get("from");
  const to = searchParams.get("to");
  if (!from || !to) {
    return NextResponse.json({ error: "from and to query params are required (ISO dates)" }, { status: 400 });
  }

  const [events, timedTasks, user] = await Promise.all([
    prisma.event.findMany({
      where: {
        userId: session.userId,
        status: { not: "CANCELLED" },
        startAt: { lte: new Date(to) },
        endAt: { gte: new Date(from) },
      },
      include: { calendarList: { include: { connection: true } } },
      orderBy: { startAt: "asc" },
    }),
    // A to-do given a time block belongs on the calendar: that block is time
    // you have committed, whether you set it yourself or Plan my day did. They
    // stay Task rows and are rendered here rather than copied into Event,
    // which would then need keeping in step on every edit, tick-off and
    // delete -- the kind of duplication that quietly drifts apart.
    prisma.task.findMany({
      where: {
        userId: session.userId,
        startAt: { not: null, lte: new Date(to) },
        endAt: { not: null, gte: new Date(from) },
      },
      orderBy: { startAt: "asc" },
    }),
    prisma.user.findUnique({ where: { id: session.userId }, select: { externalWriteEnabled: true } }),
  ]);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Shaped like an event so every view renders them with no special casing;
  // editable:false keeps them out of drag and the editor, and the id prefix
  // makes a to-do impossible to mistake for an event id in a mutation.
  const taskEntries = timedTasks.map((t) => ({
    id: `task:${t.id}`,
    kind: "task" as const,
    source: "NATIVE",
    title: t.title,
    description: t.notes,
    location: t.location,
    startAt: t.startAt as Date,
    endAt: t.endAt as Date,
    allDay: false,
    status: "CONFIRMED",
    organizer: null,
    attendees: null,
    calendarName: "To-do",
    calendarColor: null,
    color: null,
    connectionLabel: null,
    editable: false,
    recurrenceRule: null,
    recurringEventId: null,
    reminderMinutesBefore: null,
    importedVia: "todo",
    done: t.done,
  }));

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
      color: e.color,
      connectionLabel: e.calendarList?.connection.label ?? null,
      editable: e.source === "NATIVE" || user.externalWriteEnabled,
      recurrenceRule: e.recurrenceRule,
      recurringEventId: e.recurringEventId,
      reminderMinutesBefore: e.reminderMinutesBefore,
      importedVia: e.importedVia,
      kind: "event" as const,
      done: false,
    })).concat(taskEntries as never[]),
  });
}

const NATIVE_TARGET = "native";

const recurrenceSchema = z
  .object({
    freq: z.enum(["DAILY", "WEEKLY", "MONTHLY", "YEARLY"]),
    count: z.number().int().min(1).max(MAX_OCCURRENCES).optional(),
    until: z.string().optional(),
  })
  .refine((r) => r.count || r.until, { message: "Recurrence needs either a count or an end date" });

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
  // When set, materializes one Event row per occurrence (native only — see
  // src/lib/recurrence.ts for why this isn't stored as a single RRULE row).
  recurrence: recurrenceSchema.optional(),
  // Minutes before the event to send a push/Telegram reminder; purely local metadata.
  reminderMinutesBefore: z.number().int().min(0).max(43200).nullable().optional(),
  // Only meaningful for native events; synced ones take their provider's colour.
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/, "Use a #rrggbb colour").nullable().optional(),
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

  if (targets.some((t) => t !== NATIVE_TARGET)) {
    const user = await prisma.user.findUnique({ where: { id: session.userId }, select: { externalWriteEnabled: true } });
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!user.externalWriteEnabled) {
      return NextResponse.json(
        { error: "Two-way sync is turned off, so this app can't create events on Google/Outlook/iCloud — uncheck those calendars, or turn it back on in Connections." },
        { status: 400 },
      );
    }
  }

  const writeInput = {
    title: data.title,
    description: data.description ?? null,
    location: data.location ?? null,
    startAt: new Date(data.startAt),
    endAt: new Date(data.endAt),
    allDay: data.allDay ?? false,
    timezone: data.timezone ?? "UTC",
  };

  if (data.recurrence) {
    if (targets.some((t) => t !== NATIVE_TARGET)) {
      return NextResponse.json(
        { error: "Recurring events can only be created natively for now — uncheck the other calendars." },
        { status: 400 },
      );
    }

    const seriesId = randomUUID();
    const recurrenceRule = buildRecurrenceRule(data.recurrence);
    const occurrences = expandOccurrences(writeInput.startAt, writeInput.endAt, data.recurrence);

    const events = await prisma.$transaction(
      occurrences.map((occ) =>
        prisma.event.create({
          data: {
            userId: session.userId,
            source: "NATIVE",
            title: writeInput.title,
            description: writeInput.description,
            location: writeInput.location,
            startAt: occ.startAt,
            endAt: occ.endAt,
            allDay: writeInput.allDay,
            timezone: writeInput.timezone,
            status: "CONFIRMED",
            color: data.color ?? null,
            recurrenceRule,
            recurringEventId: seriesId,
            reminderMinutesBefore: data.reminderMinutesBefore ?? null,
          },
        }),
      ),
    );

    return NextResponse.json({ events });
  }

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
        color: data.color ?? null,
        reminderMinutesBefore: data.reminderMinutesBefore ?? null,
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
          reminderMinutesBefore: data.reminderMinutesBefore ?? null,
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
