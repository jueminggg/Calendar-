import { NextRequest, NextResponse } from "next/server";
import { DateTime } from "luxon";
import { prisma } from "@/lib/prisma";
import { sendTelegramMessage, sendTelegramMessageWithButtons, answerCallbackQuery } from "@/lib/telegram";
import {
  parseMessageIntent,
  parseTaskIntent,
  parseGoalIntent,
  parseWhatNextIntent,
  type EventIntent,
  type AvailabilityIntent,
  type TaskIntent,
  type GoalIntent,
} from "@/lib/telegram-intent";
import { eventSourceTag } from "@/lib/event-colors";
import { pickBestTask } from "@/lib/planDay";
import { runPlanDay, fetchBacklogTasks } from "@/lib/runPlanDay";
import type { Task } from "@prisma/client";

type TelegramUpdate = {
  message?: {
    text?: string;
    chat?: { id?: number };
  };
  callback_query?: {
    id: string;
    data?: string;
    message?: { chat?: { id?: number } };
  };
};

const IDEAS_LIST_LIMIT = 15;
// How much of an id to show/accept as a short reference for /done and /postpone.
const REF_LENGTH = 6;
const DRAFT_TTL_MINUTES = 15;

type LinkedUser = { id: string; timezone: string };

function dateOnly(dt: DateTime): string {
  return dt.toFormat("yyyy-MM-dd");
}

async function listIdeas(chatId: string, userId: string, tz: string) {
  const ideas = await prisma.idea.findMany({
    where: { userId, done: false },
    orderBy: { createdAt: "desc" },
    take: IDEAS_LIST_LIMIT,
  });
  if (ideas.length === 0) {
    await sendTelegramMessage(chatId, "No open ideas — just send me a message any time and I'll save it.");
    return;
  }
  const lines = ideas.map((idea) => {
    const when = DateTime.fromJSDate(idea.createdAt).setZone(tz).toLocaleString(DateTime.DATE_MED);
    const ref = idea.id.slice(-REF_LENGTH);
    return `• ${idea.content} (${when})\n  done? send /done ${ref}`;
  });
  await sendTelegramMessage(chatId, `💡 Your last ${ideas.length} idea${ideas.length === 1 ? "" : "s"}:\n${lines.join("\n")}`);
}

async function markIdeaDone(chatId: string, userId: string, ref: string) {
  const idea = await prisma.idea.findFirst({
    where: { userId, done: false, id: { endsWith: ref.toLowerCase() } },
    orderBy: { createdAt: "desc" },
  });
  if (!idea) {
    await sendTelegramMessage(chatId, `Couldn't find an open idea ending in "${ref}". Send /ideas to see current ones and their refs.`);
    return;
  }
  await prisma.idea.update({ where: { id: idea.id }, data: { done: true } });
  await sendTelegramMessage(chatId, `✅ Marked done: ${idea.content}`);
}

async function findClashes(userId: string, startAt: Date, endAt: Date) {
  return prisma.event.findMany({
    where: {
      userId,
      status: { not: "CANCELLED" },
      startAt: { lt: endAt },
      endAt: { gt: startAt },
    },
    orderBy: { startAt: "asc" },
    select: { title: true, startAt: true, endAt: true, allDay: true, source: true, importedVia: true },
  });
}

function formatClashes(
  events: { title: string; startAt: Date; endAt: Date; allDay: boolean; source: string; importedVia: string | null }[],
  tz: string,
): string {
  return events
    .map((e) => {
      const tag = `(${eventSourceTag(e)})`;
      if (e.allDay) return `• ${e.title} — All day ${tag}`;
      const s = DateTime.fromJSDate(e.startAt).setZone(tz).toLocaleString(DateTime.TIME_SIMPLE);
      const en = DateTime.fromJSDate(e.endAt).setZone(tz).toLocaleString(DateTime.TIME_SIMPLE);
      return `• ${e.title} ${s}–${en} ${tag}`;
    })
    .join("\n");
}

function formatWhen(startAt: Date, endAt: Date, allDay: boolean, tz: string): string {
  if (allDay) return DateTime.fromJSDate(startAt).setZone(tz).toLocaleString(DateTime.DATE_MED);
  const start = DateTime.fromJSDate(startAt).setZone(tz);
  const end = DateTime.fromJSDate(endAt).setZone(tz);
  return `${start.toLocaleString(DateTime.DATETIME_MED)} – ${end.toLocaleString(DateTime.TIME_SIMPLE)}`;
}

function formatUnplaced(tasks: Task[]): string {
  const lines = tasks.map((t) => `• ${t.title} — /postpone ${t.id.slice(-REF_LENGTH)}`);
  return `Didn't fit today:\n${lines.join("\n")}`;
}

async function handleCreateEventIntent(chatId: string, user: LinkedUser, intent: EventIntent) {
  const startAt = new Date(intent.startAt);
  const endAt = new Date(intent.endAt);
  if (Number.isNaN(startAt.getTime()) || Number.isNaN(endAt.getTime()) || endAt <= startAt) {
    await sendTelegramMessage(chatId, 'Couldn\'t figure out a valid date/time for that — try being more specific, e.g. "tomorrow 3pm".');
    return;
  }
  const tz = user.timezone || "UTC";
  const clashes = await findClashes(user.id, startAt, endAt);
  const when = formatWhen(startAt, endAt, intent.allDay, tz);

  if (clashes.length === 0) {
    const event = await prisma.event.create({
      data: {
        userId: user.id,
        source: "NATIVE",
        importedVia: "telegram",
        title: intent.title,
        startAt,
        endAt,
        allDay: intent.allDay,
        status: "CONFIRMED",
      },
    });
    await sendTelegramMessage(chatId, `✅ Scheduled: ${event.title}\n${when}`);
    return;
  }

  const draft = await prisma.telegramDraft.create({
    data: {
      userId: user.id,
      kind: "create_event",
      payload: { title: intent.title, startAt: intent.startAt, endAt: intent.endAt, allDay: intent.allDay },
      expiresAt: DateTime.utc().plus({ minutes: DRAFT_TTL_MINUTES }).toJSDate(),
    },
  });

  await sendTelegramMessageWithButtons(
    chatId,
    `⚠️ "${intent.title}" (${when}) clashes with:\n${formatClashes(clashes, tz)}\n\nCreate it anyway?`,
    [
      [
        { text: "✅ Create anyway", callback_data: `confirm:${draft.id}` },
        { text: "❌ Cancel", callback_data: `cancel:${draft.id}` },
      ],
    ],
  );
}

async function handleAvailabilityIntent(chatId: string, user: LinkedUser, intent: AvailabilityIntent) {
  const startAt = new Date(intent.startAt);
  const endAt = new Date(intent.endAt);
  if (Number.isNaN(startAt.getTime()) || Number.isNaN(endAt.getTime()) || endAt <= startAt) {
    await sendTelegramMessage(chatId, 'Couldn\'t figure out what time range you meant — try being more specific, e.g. "tomorrow 3pm".');
    return;
  }
  const tz = user.timezone || "UTC";
  const clashes = await findClashes(user.id, startAt, endAt);
  const when = formatWhen(startAt, endAt, false, tz);

  if (clashes.length === 0) {
    await sendTelegramMessage(chatId, `✅ You're free ${when}.`);
    return;
  }
  await sendTelegramMessage(chatId, `❌ Not free ${when} — you have:\n${formatClashes(clashes, tz)}`);
}

async function handleAddTaskIntent(chatId: string, user: LinkedUser, intent: TaskIntent) {
  const tz = user.timezone || "UTC";
  const today = DateTime.now().setZone(tz).startOf("day");
  const dateStr = dateOnly(today);

  const task = await prisma.task.create({
    data: {
      userId: user.id,
      title: intent.title,
      date: today.toJSDate(),
      deadline: intent.deadline ? new Date(intent.deadline) : undefined,
      priority: intent.priority,
      location: intent.location,
      estimatedMinutes: intent.estimatedMinutes,
    },
  });

  let result;
  try {
    result = await runPlanDay(user.id, tz, dateStr);
  } catch (err) {
    console.error("Auto-replan after Telegram task add failed", err);
    await sendTelegramMessage(chatId, `📝 Added "${task.title}" to today's backlog (couldn't auto-schedule it right now).`);
    return;
  }

  const placed = result.scheduled.find((t) => t.id === task.id);
  const lines: string[] = [];
  if (placed) {
    lines.push(`📝 Added and scheduled: ${placed.title}\n${formatWhen(placed.startAt!, placed.endAt!, false, tz)}`);
  } else {
    lines.push(`📝 Added "${task.title}" — didn't fit today's schedule right now.`);
  }
  if (result.unplaced.length > 0) {
    lines.push(formatUnplaced(result.unplaced));
  }
  await sendTelegramMessage(chatId, lines.join("\n\n"));
}

async function handleAddGoalIntent(chatId: string, user: LinkedUser, intent: GoalIntent) {
  const tz = user.timezone || "UTC";
  const today = DateTime.now().setZone(tz).startOf("day");
  const dateStr = dateOnly(today);
  const deadline = intent.deadline ? new Date(intent.deadline) : undefined;

  // Materialized as N independent flexible (date: null) sessions, same
  // pattern as native recurring calendar events — each one gets picked up
  // by whichever day's plan actually has room before the deadline, rather
  // than all being dumped onto today.
  const sessions = await prisma.$transaction(
    Array.from({ length: intent.sessions }, (_, i) =>
      prisma.task.create({
        data: {
          userId: user.id,
          title: `${intent.title} (${i + 1}/${intent.sessions})`,
          date: null,
          deadline,
          priority: intent.priority,
          location: intent.location,
          estimatedMinutes: intent.estimatedMinutes,
        },
      }),
    ),
  );

  let result;
  try {
    result = await runPlanDay(user.id, tz, dateStr);
  } catch (err) {
    console.error("Auto-replan after Telegram goal add failed", err);
    await sendTelegramMessage(
      chatId,
      `🎯 Added goal: ${intent.title} — ${intent.sessions} sessions × ${intent.estimatedMinutes} min${
        intent.deadline ? `, due ${formatWhen(deadline!, deadline!, true, tz)}` : ""
      }. Couldn't auto-schedule right now, but they're in your flexible backlog.`,
    );
    return;
  }

  const sessionIds = new Set(sessions.map((s) => s.id));
  const placedToday = result.scheduled.filter((t) => sessionIds.has(t.id));
  const lines = [
    `🎯 Added goal: ${intent.title} — ${intent.sessions} sessions × ${intent.estimatedMinutes} min${
      intent.deadline ? `, due ${formatWhen(deadline!, deadline!, true, tz)}` : ""
    }.`,
  ];
  if (placedToday.length > 0) {
    lines.push(`${placedToday.length} session${placedToday.length === 1 ? "" : "s"} scheduled today; the rest are flexible before the deadline.`);
  } else {
    lines.push("All sessions are flexible for now — I'll slot them in as your days have room.");
  }
  await sendTelegramMessage(chatId, lines.join("\n"));
}

async function handlePostpone(chatId: string, userId: string, ref: string) {
  const task = await prisma.task.findFirst({
    where: { userId, done: false, id: { endsWith: ref.toLowerCase() } },
    orderBy: { createdAt: "desc" },
  });
  if (!task) {
    await sendTelegramMessage(chatId, `Couldn't find an open to-do ending in "${ref}".`);
    return;
  }
  if (!task.date) {
    await sendTelegramMessage(
      chatId,
      `"${task.title}" is flexible (no fixed day yet) — it'll get picked up automatically before its deadline, no need to postpone it.`,
    );
    return;
  }
  const nextDay = DateTime.fromJSDate(task.date, { zone: "utc" }).plus({ days: 1 }).toJSDate();
  await prisma.task.update({ where: { id: task.id }, data: { date: nextDay, startAt: null, endAt: null } });
  await sendTelegramMessage(chatId, `↪️ Postponed to tomorrow: ${task.title}`);
}

async function handleWhatNext(chatId: string, user: LinkedUser, atISO: string, durationMinutes: number | null) {
  const at = new Date(atISO);
  const tz = user.timezone || "UTC";

  const event = await prisma.event.findFirst({
    where: { userId: user.id, status: { not: "CANCELLED" }, startAt: { lte: at }, endAt: { gt: at } },
    orderBy: { startAt: "asc" },
  });
  if (event) {
    await sendTelegramMessage(
      chatId,
      `📅 ${event.title} (${formatWhen(event.startAt, event.endAt, event.allDay, tz)}) (${eventSourceTag(event)})`,
    );
    return;
  }

  const task = await prisma.task.findFirst({
    where: { userId: user.id, done: false, startAt: { lte: at }, endAt: { gt: at } },
    orderBy: { startAt: "asc" },
  });
  if (task) {
    await sendTelegramMessage(chatId, `✅ ${task.title}${task.location ? ` (${task.location})` : ""}`);
    return;
  }

  const today = DateTime.fromJSDate(at, { zone: tz }).startOf("day").toJSDate();
  const backlog = await fetchBacklogTasks(user.id, today);
  if (backlog.length === 0) {
    await sendTelegramMessage(chatId, "Nothing scheduled then — you're free.");
    return;
  }

  // With a break length given ("I have a 15 min break"), only suggest
  // something that actually fits, ranked the same way Plan my day would.
  // Without one, still use the same ranking but with no duration cap, so
  // it's just "the single most urgent thing" regardless of how long it takes.
  const suggestion = pickBestTask(
    backlog.map((t) => ({ id: t.id, estimatedMinutes: t.estimatedMinutes, deadline: t.deadline, priority: t.priority, location: t.location })),
    durationMinutes ?? Infinity,
  );

  if (!suggestion) {
    await sendTelegramMessage(
      chatId,
      durationMinutes !== null ? `Nothing in your backlog fits ${durationMinutes} min right now.` : "Nothing in your backlog fits right now.",
    );
    return;
  }

  const suggestedTask = backlog.find((t) => t.id === suggestion.id)!;
  const durationLabel = suggestedTask.estimatedMinutes ? ` (${suggestedTask.estimatedMinutes} min)` : "";
  await sendTelegramMessage(chatId, `Nothing scheduled then — free time. Next up: ${suggestedTask.title}${durationLabel}`);
}

async function handleCallbackQuery(callbackQuery: NonNullable<TelegramUpdate["callback_query"]>) {
  const chatId = callbackQuery.message?.chat?.id;
  const data = callbackQuery.data;
  if (!chatId || !data) {
    await answerCallbackQuery(callbackQuery.id);
    return;
  }
  const chatIdStr = String(chatId);
  const [action, draftId] = data.split(":");

  const draft = draftId ? await prisma.telegramDraft.findUnique({ where: { id: draftId } }) : null;
  if (!draft || draft.expiresAt < new Date()) {
    await answerCallbackQuery(callbackQuery.id, "This has expired.");
    await sendTelegramMessage(chatIdStr, "That request expired — send the event again if you still want it.");
    if (draft) await prisma.telegramDraft.delete({ where: { id: draft.id } }).catch(() => {});
    return;
  }

  const linkedUser = await prisma.user.findUnique({ where: { telegramChatId: chatIdStr } });
  if (!linkedUser || linkedUser.id !== draft.userId) {
    await answerCallbackQuery(callbackQuery.id, "Not authorized.");
    return;
  }

  await prisma.telegramDraft.delete({ where: { id: draft.id } });

  if (action === "cancel") {
    await answerCallbackQuery(callbackQuery.id, "Cancelled");
    await sendTelegramMessage(chatIdStr, "Cancelled — send a new time whenever you're ready.");
    return;
  }

  if (action === "confirm" && draft.kind === "create_event") {
    const payload = draft.payload as { title: string; startAt: string; endAt: string; allDay: boolean };
    const event = await prisma.event.create({
      data: {
        userId: linkedUser.id,
        source: "NATIVE",
        importedVia: "telegram",
        title: payload.title,
        startAt: new Date(payload.startAt),
        endAt: new Date(payload.endAt),
        allDay: payload.allDay,
        status: "CONFIRMED",
      },
    });
    await answerCallbackQuery(callbackQuery.id, "Created");
    const tz = linkedUser.timezone || "UTC";
    await sendTelegramMessage(chatIdStr, `✅ Scheduled anyway: ${event.title}\n${formatWhen(event.startAt, event.endAt, event.allDay, tz)}`);
    return;
  }

  await answerCallbackQuery(callbackQuery.id);
}

/**
 * Public webhook Telegram calls on every message. Authenticated via the
 * secret token Telegram echoes back in a header (set once via setWebhook in
 * /api/telegram/setup), not via our own session — there is no logged-in user
 * on this request.
 */
export async function POST(request: NextRequest) {
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (secret) {
    const provided = request.headers.get("x-telegram-bot-api-secret-token");
    if (provided !== secret) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  const update = (await request.json().catch(() => null)) as TelegramUpdate | null;

  if (update?.callback_query) {
    await handleCallbackQuery(update.callback_query);
    return NextResponse.json({ ok: true });
  }

  const text = update?.message?.text?.trim();
  const chatId = update?.message?.chat?.id;
  if (!text || !chatId) {
    return NextResponse.json({ ok: true });
  }
  const chatIdStr = String(chatId);

  const startMatch = text.match(/^\/start(?:@\S+)?\s+(\S+)/);
  if (startMatch) {
    const code = startMatch[1];
    const user = await prisma.user.findFirst({
      where: { telegramLinkCode: code, telegramLinkCodeExpiresAt: { gt: new Date() } },
    });
    if (!user) {
      await sendTelegramMessage(chatIdStr, "That link code is invalid or expired. Generate a new one in the app and try again.");
      return NextResponse.json({ ok: true });
    }

    // If this Telegram chat was previously linked to a different account, free
    // it up first since telegramChatId is unique.
    await prisma.user.updateMany({
      where: { telegramChatId: chatIdStr, NOT: { id: user.id } },
      data: { telegramChatId: null },
    });
    await prisma.user.update({
      where: { id: user.id },
      data: { telegramChatId: chatIdStr, telegramLinkCode: null, telegramLinkCodeExpiresAt: null },
    });
    await sendTelegramMessage(
      chatIdStr,
      'Linked! Send me a message like "lunch with sarah tomorrow 1pm" to schedule it, "am I free friday 3pm?" to check your calendar, "need to call the bank while traveling" to add a to-do (auto-slotted in), "need to practice for the exam 4 times, 20 min each, by friday" to add a multi-session goal, "what should I do, I have a 15 min break?" any time, or anything else to jot down as an idea. /ideas, /done <ref>, /postpone <ref>.',
    );
    return NextResponse.json({ ok: true });
  }

  const linkedUser = await prisma.user.findUnique({ where: { telegramChatId: chatIdStr } });
  if (!linkedUser) {
    await sendTelegramMessage(
      chatIdStr,
      "Hi! Open Settings → Notifications in the calendar app and tap \"Link Telegram\" to get a link, then come back here.",
    );
    return NextResponse.json({ ok: true });
  }

  if (/^\/ideas(?:@\S+)?(\s|$)/i.test(text)) {
    await listIdeas(chatIdStr, linkedUser.id, linkedUser.timezone || "UTC");
    return NextResponse.json({ ok: true });
  }

  const doneMatch = text.match(/^\/done(?:@\S+)?\s+(\S+)/i);
  if (doneMatch) {
    await markIdeaDone(chatIdStr, linkedUser.id, doneMatch[1]);
    return NextResponse.json({ ok: true });
  }

  const postponeMatch = text.match(/^\/postpone(?:@\S+)?\s+(\S+)/i);
  if (postponeMatch) {
    await handlePostpone(chatIdStr, linkedUser.id, postponeMatch[1]);
    return NextResponse.json({ ok: true });
  }

  const taskCommandMatch = text.match(/^\/task(?:@\S+)?\s+([\s\S]+)/i);
  if (taskCommandMatch) {
    const opts = { timezone: linkedUser.timezone || "UTC", now: new Date(), force: true };
    const forcedGoal = parseGoalIntent(taskCommandMatch[1], opts);
    if (forcedGoal) {
      await handleAddGoalIntent(chatIdStr, linkedUser, forcedGoal);
    } else {
      const forcedTask = parseTaskIntent(taskCommandMatch[1], opts);
      if (forcedTask) await handleAddTaskIntent(chatIdStr, linkedUser, forcedTask);
    }
    return NextResponse.json({ ok: true });
  }

  if (text.startsWith("/")) {
    await sendTelegramMessage(
      chatIdStr,
      "Unknown command. Try /ideas, /done <ref>, /postpone <ref>, /task <text>, or just send a message.",
    );
    return NextResponse.json({ ok: true });
  }

  const tz = linkedUser.timezone || "UTC";
  const now = new Date();

  const whatNext = parseWhatNextIntent(text, { timezone: tz, now });
  if (whatNext) {
    await handleWhatNext(chatIdStr, linkedUser, whatNext.at, whatNext.durationMinutes);
    return NextResponse.json({ ok: true });
  }

  const goalIntent = parseGoalIntent(text, { timezone: tz, now });
  if (goalIntent) {
    await handleAddGoalIntent(chatIdStr, linkedUser, goalIntent);
    return NextResponse.json({ ok: true });
  }

  const taskIntent = parseTaskIntent(text, { timezone: tz, now });
  if (taskIntent) {
    await handleAddTaskIntent(chatIdStr, linkedUser, taskIntent);
    return NextResponse.json({ ok: true });
  }

  const intent = parseMessageIntent(text, { timezone: tz, now });

  if (intent.kind === "create_event") {
    await handleCreateEventIntent(chatIdStr, linkedUser, intent);
    return NextResponse.json({ ok: true });
  }
  if (intent.kind === "check_availability") {
    await handleAvailabilityIntent(chatIdStr, linkedUser, intent);
    return NextResponse.json({ ok: true });
  }

  await prisma.idea.create({ data: { userId: linkedUser.id, content: text } });
  await sendTelegramMessage(chatIdStr, "💡 Saved. Send /ideas any time to see your open ones.");
  return NextResponse.json({ ok: true });
}
