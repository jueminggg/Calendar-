import { NextRequest, NextResponse } from "next/server";
import { DateTime } from "luxon";
import { prisma } from "@/lib/prisma";
import { sendPushToUser } from "@/lib/push";

/**
 * True once local time has reached (or just passed) the target HH:MM, within
 * a generous window so an infrequent external poller doesn't miss it. Vercel
 * Hobby's cron only runs once a day (see /api/cron/sync), so this endpoint is
 * meant to be hit every 15-30 min by an external scheduler instead — see README.
 */
function isDue(now: DateTime, target: string): boolean {
  const [hour, minute] = target.split(":").map(Number);
  const targetToday = now.set({ hour, minute, second: 0, millisecond: 0 });
  const diffMinutes = now.diff(targetToday, "minutes").minutes;
  return diffMinutes >= 0 && diffMinutes < 60;
}

function alreadySentToday(sentAt: Date | null, tz: string, todayKey: string): boolean {
  if (!sentAt) return false;
  return DateTime.fromJSDate(sentAt).setZone(tz).toISODate() === todayKey;
}

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const provided = request.headers.get("authorization");
    if (provided !== `Bearer ${secret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  const users = await prisma.user.findMany({ where: { remindersEnabled: true } });
  let sent = 0;

  for (const user of users) {
    const tz = user.timezone || "UTC";
    const now = DateTime.now().setZone(tz);
    const todayKey = now.toISODate() ?? "";

    if (!alreadySentToday(user.lastMorningReminderSentAt, tz, todayKey) && isDue(now, user.morningReminderTime)) {
      await sendPushToUser(user.id, {
        title: "Plan your day",
        body: "Review your calendar and set today's to-dos.",
        url: "/todo",
      });
      await prisma.user.update({ where: { id: user.id }, data: { lastMorningReminderSentAt: now.toJSDate() } });
      sent++;
    }

    if (!alreadySentToday(user.lastEveningReminderSentAt, tz, todayKey) && isDue(now, user.eveningReminderTime)) {
      await sendPushToUser(user.id, {
        title: "Check off your day",
        body: "See what you got done and carry over what's left.",
        url: "/todo",
      });
      await prisma.user.update({ where: { id: user.id }, data: { lastEveningReminderSentAt: now.toJSDate() } });
      sent++;
    }
  }

  // Per-event reminders are independent of the daily morning/evening toggle
  // above — they fire for any user with a reminder set on a specific event,
  // regardless of whether daily planning reminders are enabled.
  const nowUtc = DateTime.utc();
  const dueEvents = await prisma.event.findMany({
    where: {
      reminderMinutesBefore: { not: null },
      reminderSentAt: null,
      // Grace window: skip events whose reminder time has been due for over
      // an hour, so a scheduler outage doesn't fire a pile of stale alerts.
      startAt: { gte: nowUtc.minus({ hours: 1 }).toJSDate() },
    },
    select: {
      id: true,
      userId: true,
      title: true,
      location: true,
      startAt: true,
      reminderMinutesBefore: true,
      user: { select: { timezone: true } },
    },
  });

  for (const event of dueEvents) {
    const fireAt = DateTime.fromJSDate(event.startAt).minus({ minutes: event.reminderMinutesBefore ?? 0 });
    if (nowUtc < fireAt) continue;
    const tz = event.user.timezone || "UTC";
    const timeLabel = DateTime.fromJSDate(event.startAt).setZone(tz).toLocaleString(DateTime.TIME_SIMPLE);
    const body = event.location ? `${timeLabel} · ${event.location}` : timeLabel;
    await sendPushToUser(event.userId, { title: event.title, body, url: "/" });
    await prisma.event.update({ where: { id: event.id }, data: { reminderSentAt: nowUtc.toJSDate() } });
    sent++;
  }

  return NextResponse.json({ checked: users.length, sent });
}
