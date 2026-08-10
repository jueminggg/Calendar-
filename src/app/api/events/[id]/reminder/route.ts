import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";

const schema = z.object({
  // Minutes before the event to send a push/Telegram reminder; null clears it.
  reminderMinutesBefore: z.number().int().min(0).max(43200).nullable(),
});

/**
 * A per-event reminder is purely local metadata — it never touches the
 * source provider — so it's always settable regardless of whether two-way
 * sync (externalWriteEnabled) is on, and regardless of event source.
 */
export async function PATCH(request: NextRequest, ctx: RouteContext<"/api/events/[id]/reminder">) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await ctx.params;
  const event = await prisma.event.findUnique({ where: { id } });
  if (!event || event.userId !== session.userId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const body = await request.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
  }

  const updated = await prisma.event.update({
    where: { id },
    data: { reminderMinutesBefore: parsed.data.reminderMinutesBefore, reminderSentAt: null },
    select: { id: true, reminderMinutesBefore: true },
  });
  return NextResponse.json(updated);
}
