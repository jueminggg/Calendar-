import { NextRequest, NextResponse } from "next/server";
import { DateTime } from "luxon";
import { prisma } from "@/lib/prisma";
import { sendTelegramMessage, sendTelegramMessageWithButtons, answerCallbackQuery } from "@/lib/telegram";
import { parseMessageIntent, type EventIntent, type AvailabilityIntent } from "@/lib/telegram-intent";
import { eventSourceTag } from "@/lib/event-colors";

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
// How much of an idea's id to show/accept as its short reference for /done.
const REF_LENGTH = 6;
const DRAFT_TTL_MINUTES = 15;

type LinkedUser = { id: string; timezone: string };

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
      'Linked! Send me a message like "lunch with sarah tomorrow 1pm" to schedule it, "am I free friday 3pm?" to check your calendar, or anything else to jot it down as an idea. /ideas lists open ideas, /done <ref> marks one done.',
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

  if (text.startsWith("/")) {
    await sendTelegramMessage(chatIdStr, "Unknown command. Try /ideas or /done <ref>, or just send a message to save it as an idea, schedule an event, or check availability.");
    return NextResponse.json({ ok: true });
  }

  const intent = parseMessageIntent(text, { timezone: linkedUser.timezone || "UTC", now: new Date() });

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
