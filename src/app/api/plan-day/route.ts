import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { DateTime } from "luxon";
import { getSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { getTravelMinutes } from "@/lib/travelTime";
import {
  computeRawWindows,
  applyTravelBuffer,
  assignTasks,
  DEFAULT_DAY_START_HOUR,
  DEFAULT_DAY_END_HOUR,
  type FreeWindow,
} from "@/lib/planDay";

const bodySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD"),
  // Exposed for flexibility, but the UI doesn't currently offer a way to
  // change these — v1 just uses the defaults.
  dayStartHour: z.number().int().min(0).max(23).optional(),
  dayEndHour: z.number().int().min(1).max(24).optional(),
});

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
  }
  const { date, dayStartHour = DEFAULT_DAY_START_HOUR, dayEndHour = DEFAULT_DAY_END_HOUR } = parsed.data;

  const user = await prisma.user.findUniqueOrThrow({ where: { id: session.userId }, select: { timezone: true } });
  const tz = user.timezone || "UTC";

  const dayStartLocal = DateTime.fromISO(date, { zone: tz }).startOf("day");
  if (!dayStartLocal.isValid) {
    return NextResponse.json({ error: "Invalid date" }, { status: 400 });
  }

  // Midnight-to-midnight, for fetching every event that could overlap the
  // planning window below (an event starting before dayStartHour still eats
  // into it if it runs past dayStartHour).
  const dayStart = dayStartLocal.toJSDate();
  const dayEnd = dayStartLocal.plus({ days: 1 }).toJSDate();
  const planStart = dayStartLocal.plus({ hours: dayStartHour }).toJSDate();
  const planEnd = dayStartLocal.plus({ hours: dayEndHour }).toJSDate();

  const [events, backlogTasks] = await Promise.all([
    prisma.event.findMany({
      where: { userId: session.userId, status: { not: "CANCELLED" }, startAt: { lt: dayEnd }, endAt: { gt: dayStart } },
      orderBy: { startAt: "asc" },
      select: { startAt: true, endAt: true, location: true },
    }),
    // Same-day backlog only, matching how Task.date already scopes things —
    // multi-day/undated backlog planning is out of scope for v1.
    prisma.task.findMany({
      where: { userId: session.userId, date: dayStart, startAt: null, done: false },
      orderBy: [{ order: "asc" }, { createdAt: "asc" }],
    }),
  ]);

  const rawWindows = computeRawWindows(planStart, planEnd, events);

  const trimmedWindows: FreeWindow[] = [];
  for (const window of rawWindows) {
    let bufferMinutes = 0;
    if (
      window.beforeLocation &&
      window.afterLocation &&
      window.beforeLocation.trim().toLowerCase() !== window.afterLocation.trim().toLowerCase()
    ) {
      // Fails open to 0 (no buffer) if GOOGLE_MAPS_API_KEY isn't set or the
      // lookup fails — travel time is a scheduling nicety, not a
      // requirement for the feature to work at all.
      bufferMinutes = (await getTravelMinutes(window.beforeLocation, window.afterLocation)) ?? 0;
    }
    const trimmed = applyTravelBuffer(window, bufferMinutes);
    if (trimmed) trimmedWindows.push(trimmed);
  }

  const { placements, unplacedIds } = assignTasks(
    trimmedWindows,
    backlogTasks.map((t) => ({ id: t.id, estimatedMinutes: t.estimatedMinutes, deadline: t.deadline, priority: t.priority })),
  );

  const scheduled = await prisma.$transaction(
    placements.map((p) => prisma.task.update({ where: { id: p.taskId }, data: { startAt: p.startAt, endAt: p.endAt } })),
  );

  const unplaced = backlogTasks.filter((t) => unplacedIds.includes(t.id));

  return NextResponse.json({ scheduled, unplaced });
}
