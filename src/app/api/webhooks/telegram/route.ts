import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { sendTelegramMessage } from "@/lib/telegram";

type TelegramUpdate = {
  message?: {
    text?: string;
    chat?: { id?: number };
  };
};

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
  const text = update?.message?.text;
  const chatId = update?.message?.chat?.id;
  if (!text || !chatId) {
    return NextResponse.json({ ok: true });
  }

  const match = text.trim().match(/^\/start(?:@\S+)?\s+(\S+)/);
  if (!match) {
    await sendTelegramMessage(
      String(chatId),
      "Hi! Open Settings → Notifications in the calendar app and tap \"Link Telegram\" to get a link, then come back here.",
    );
    return NextResponse.json({ ok: true });
  }

  const code = match[1];
  const user = await prisma.user.findFirst({
    where: { telegramLinkCode: code, telegramLinkCodeExpiresAt: { gt: new Date() } },
  });
  if (!user) {
    await sendTelegramMessage(String(chatId), "That link code is invalid or expired. Generate a new one in the app and try again.");
    return NextResponse.json({ ok: true });
  }

  // If this Telegram chat was previously linked to a different account, free
  // it up first since telegramChatId is unique.
  await prisma.user.updateMany({
    where: { telegramChatId: String(chatId), NOT: { id: user.id } },
    data: { telegramChatId: null },
  });
  await prisma.user.update({
    where: { id: user.id },
    data: { telegramChatId: String(chatId), telegramLinkCode: null, telegramLinkCodeExpiresAt: null },
  });
  await sendTelegramMessage(String(chatId), "Linked! I'll send your daily agenda and event reminders here.");
  return NextResponse.json({ ok: true });
}
