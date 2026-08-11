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

async function listIdeas(chatId: string, userId: string, tz: string) {
  const ideas = await prisma.idea.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    take: IDEAS_LIST_LIMIT,
  });
  if (ideas.length === 0) {
    await sendTelegramMessage(chatId, "No ideas saved yet — just send me a message any time and I'll save it.");
    return;
  }
  const lines = ideas.map((idea) => {
    const when = DateTime.fromJSDate(idea.createdAt).setZone(tz).toLocaleString(DateTime.DATE_MED);
    return `• ${idea.content} (${when})`;
  });
  await sendTelegramMessage(chatId, `💡 Your last ${ideas.length} idea${ideas.length === 1 ? "" : "s"}:\n${lines.join("\n")}`);
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
      "Linked! I'll send your daily agenda and event reminders here. Send me any message to jot down an idea, or /ideas to see recent ones.",
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

  if (text.startsWith("/")) {
    await sendTelegramMessage(chatIdStr, "Unknown command. Try /ideas, or just send a message to save it as an idea.");
    return NextResponse.json({ ok: true });
  }

  await prisma.idea.create({ data: { userId: linkedUser.id, content: text } });
  await sendTelegramMessage(chatIdStr, "💡 Saved. Send /ideas any time to see your recent ones.");
  return NextResponse.json({ ok: true });
}
