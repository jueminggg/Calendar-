import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";

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
  const event = await prisma.event.findUnique({ where: { id } });
  if (!event || event.userId !== session.userId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (event.source !== "NATIVE") {
    return NextResponse.json(
      { error: "This event is synced from an external calendar and can't be edited here yet." },
      { status: 400 },
    );
  }

  const body = await request.json().catch(() => null);
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
  }
  const data = parsed.data;

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

export async function DELETE(_request: NextRequest, ctx: RouteContext<"/api/events/[id]">) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await ctx.params;
  const event = await prisma.event.findUnique({ where: { id } });
  if (!event || event.userId !== session.userId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (event.source !== "NATIVE") {
    return NextResponse.json(
      { error: "This event is synced from an external calendar and can't be deleted here yet." },
      { status: 400 },
    );
  }

  await prisma.event.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
