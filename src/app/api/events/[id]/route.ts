import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { updateEventOnProvider, deleteEventOnProvider } from "@/lib/sync/write";

const updateSchema = z.object({
  title: z.string().min(1).optional(),
  description: z.string().nullable().optional(),
  location: z.string().nullable().optional(),
  startAt: z.string().optional(),
  endAt: z.string().optional(),
  allDay: z.boolean().optional(),
});

export async function PATCH(request: NextRequest, ctx: RouteContext<"/api/events/[id]">) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await ctx.params;
  const event = await prisma.event.findUnique({ where: { id }, include: { calendarList: { include: { connection: true } } } });
  if (!event || event.userId !== session.userId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const body = await request.json().catch(() => null);
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
  }
  const data = parsed.data;

  if (event.source === "NATIVE") {
    const updated = await prisma.event.update({
      where: { id },
      data: {
        title: data.title,
        description: data.description,
        location: data.location,
        startAt: data.startAt ? new Date(data.startAt) : undefined,
        endAt: data.endAt ? new Date(data.endAt) : undefined,
        allDay: data.allDay,
      },
    });
    return NextResponse.json({ event: updated });
  }

  if (!event.calendarList || !event.externalId) {
    return NextResponse.json({ error: "This event isn't linked to a connected calendar." }, { status: 400 });
  }

  const merged = {
    title: data.title ?? event.title,
    description: data.description !== undefined ? data.description : event.description,
    location: data.location !== undefined ? data.location : event.location,
    startAt: data.startAt ? new Date(data.startAt) : event.startAt,
    endAt: data.endAt ? new Date(data.endAt) : event.endAt,
    allDay: data.allDay ?? event.allDay,
    timezone: event.timezone,
  };

  let result;
  try {
    result = await updateEventOnProvider(
      event.calendarList,
      { externalId: event.externalId, icalUid: event.icalUid, providerEtag: event.providerEtag },
      merged,
    );
  } catch (err) {
    console.error("Failed to update event on provider", err);
    const message = err instanceof Error ? err.message : "Couldn't update the event on that calendar.";
    return NextResponse.json({ error: message }, { status: 502 });
  }

  const updated = await prisma.event.update({
    where: { id },
    data: {
      title: merged.title,
      description: merged.description,
      location: merged.location,
      startAt: merged.startAt,
      endAt: merged.endAt,
      allDay: merged.allDay,
      externalId: result.externalId,
      icalUid: result.icalUid,
      providerUpdatedAt: result.providerUpdatedAt,
      providerEtag: result.providerEtag,
    },
  });

  return NextResponse.json({ event: updated });
}

export async function DELETE(_request: NextRequest, ctx: RouteContext<"/api/events/[id]">) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await ctx.params;
  const event = await prisma.event.findUnique({ where: { id }, include: { calendarList: { include: { connection: true } } } });
  if (!event || event.userId !== session.userId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  if (event.source !== "NATIVE") {
    if (!event.calendarList || !event.externalId) {
      return NextResponse.json({ error: "This event isn't linked to a connected calendar." }, { status: 400 });
    }
    try {
      await deleteEventOnProvider(event.calendarList, { externalId: event.externalId, providerEtag: event.providerEtag });
    } catch (err) {
      console.error("Failed to delete event on provider", err);
      const message = err instanceof Error ? err.message : "Couldn't delete the event on that calendar.";
      return NextResponse.json({ error: message }, { status: 502 });
    }
  }

  await prisma.event.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
