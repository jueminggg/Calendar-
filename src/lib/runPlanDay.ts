import { DateTime } from "luxon";
import type { Task } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getTravelMinutes } from "@/lib/travelTime";
import {
  computeRawWindows,
  splitForTravel,
  assignTasks,
  DEFAULT_DAY_START_HOUR,
  DEFAULT_DAY_END_HOUR,
  type LocatedWindow,
} from "@/lib/planDay";

export type RunPlanDayResult = { scheduled: Task[]; unplaced: Task[] };

/**
 * A day's eligible backlog: still-untimed tasks actually dated to this day,
 * plus "flexible" tasks (no day assigned, just a deadline — e.g. one
 * session of a multi-session goal) that haven't been picked up by any day
 * yet. Shared by runPlanDay and the Telegram "what fits in my N-minute
 * break" query so both see the same pool.
 */
export async function fetchBacklogTasks(userId: string, dayStart: Date): Promise<Task[]> {
  return prisma.task.findMany({
    where: {
      userId,
      startAt: null,
      done: false,
      OR: [{ date: dayStart }, { date: null, deadline: { not: null } }],
    },
    orderBy: [{ order: "asc" }, { createdAt: "asc" }],
  });
}

/**
 * The actual "Plan my day" logic: fetch the day's fixed calendar blocks and
 * still-untimed backlog tasks, compute free (and travel-buffer) windows, and
 * greedily slot tasks into them. Shared between the HTTP route
 * (/api/plan-day) and the Telegram bot's auto-replan-on-add flow so neither
 * duplicates the DB/travel-time wiring.
 */
export async function runPlanDay(
  userId: string,
  tz: string,
  date: string,
  opts?: { dayStartHour?: number; dayEndHour?: number },
): Promise<RunPlanDayResult> {
  const dayStartHour = opts?.dayStartHour ?? DEFAULT_DAY_START_HOUR;
  const dayEndHour = opts?.dayEndHour ?? DEFAULT_DAY_END_HOUR;

  const dayStartLocal = DateTime.fromISO(date, { zone: tz }).startOf("day");
  if (!dayStartLocal.isValid) {
    throw new Error("Invalid date");
  }

  // Midnight-to-midnight, for fetching every event that could overlap the
  // planning window (an event starting before dayStartHour still eats into
  // it if it runs past dayStartHour).
  const dayStart = dayStartLocal.toJSDate();
  const dayEnd = dayStartLocal.plus({ days: 1 }).toJSDate();
  const planStart = dayStartLocal.plus({ hours: dayStartHour }).toJSDate();
  const planEnd = dayStartLocal.plus({ hours: dayEndHour }).toJSDate();

  const [events, scheduledTasks, backlogTasks] = await Promise.all([
    prisma.event.findMany({
      where: { userId, status: { not: "CANCELLED" }, startAt: { lt: dayEnd }, endAt: { gt: dayStart } },
      orderBy: { startAt: "asc" },
      select: { startAt: true, endAt: true, location: true },
    }),
    // Tasks already given a time — by a previous run of this same function,
    // or set manually — are fixed blocks too: without this, calling
    // runPlanDay more than once in a day (as the Telegram add-a-to-do flow
    // does, once per message) could schedule a new task right on top of one
    // it already placed, since only the backlog query below excludes them.
    prisma.task.findMany({
      where: { userId, date: dayStart, startAt: { not: null }, endAt: { not: null }, done: false },
      select: { startAt: true, endAt: true },
    }),
    fetchBacklogTasks(userId, dayStart),
  ]);

  const fixedBlocks = [
    ...events,
    // A task's own location preference shouldn't leak into the surrounding
    // window's location tag the way an event's location does, so these
    // carry no location.
    ...scheduledTasks.map((t) => ({ startAt: t.startAt!, endAt: t.endAt!, location: null })),
  ];

  const rawWindows = computeRawWindows(planStart, planEnd, fixedBlocks);

  const locatedWindows: LocatedWindow[] = [];
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
    locatedWindows.push(...splitForTravel(window, bufferMinutes));
  }

  const { placements, unplacedIds } = assignTasks(
    locatedWindows,
    backlogTasks.map((t) => ({ id: t.id, estimatedMinutes: t.estimatedMinutes, deadline: t.deadline, priority: t.priority, location: t.location })),
  );

  const scheduled = await prisma.$transaction(
    // Setting date here too converts a flexible (date: null) task into a
    // dated one, the first time it actually gets scheduled somewhere.
    placements.map((p) => prisma.task.update({ where: { id: p.taskId }, data: { startAt: p.startAt, endAt: p.endAt, date: dayStart } })),
  );

  const unplaced = backlogTasks.filter((t) => unplacedIds.includes(t.id));

  return { scheduled, unplaced };
}
