import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";

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
      editable: e.source === "NATIVE",
    })),
  });
}

const createSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional(),
  location: z.string().optional(),
  startAt: z.string(),
  endAt: z.string(),
  allDay: z.boolean().optional(),
  timezone: z.string().optional(),
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

  const event = await prisma.event.create({
    data: {
      userId: session.userId,
      source: "NATIVE",
      title: data.title,
      description: data.description,
      location: data.location,
      startAt: new Date(data.startAt),
      endAt: new Date(data.endAt),
      allDay: data.allDay ?? false,
      timezone: data.timezone ?? "UTC",
      status: "CONFIRMED",
    },
  });

  return NextResponse.json({ event });
}
