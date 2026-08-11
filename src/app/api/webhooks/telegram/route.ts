import { NextRequest, NextResponse } from "next/server";
import { DateTime } from "luxon";
import { prisma } from "@/lib/prisma";
import { sendTelegramMessage } from "@/lib/telegram";

type TelegramUpdate = {
  message?: {
    text?: string;
    chat?: { id?: number };
  };
};

const IDEAS_LIST_LIMIT = 15;
// How much of an idea's id to show/accept as its short reference for /done.
const REF_LENGTH = 6;

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
      "Linked! I'll send your daily agenda and event reminders here. Send me any message to jot down an idea, /ideas to see open ones, or /done <ref> once you've acted on one.",
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
    await sendTelegramMessage(chatIdStr, "Unknown command. Try /ideas or /done <ref>, or just send a message to save it as an idea.");
    return NextResponse.json({ ok: true });
  }

  await prisma.idea.create({ data: { userId: linkedUser.id, content: text } });
  await sendTelegramMessage(chatIdStr, "💡 Saved. Send /ideas any time to see your open ones.");
  return NextResponse.json({ ok: true });
}
