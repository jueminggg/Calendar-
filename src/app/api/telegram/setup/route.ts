import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { setTelegramWebhook } from "@/lib/telegram";

/**
 * One-time (or re-run-anytime) setup: registers this deployment's URL as the
 * Telegram bot's webhook. Visit this route once, logged in, after setting
 * TELEGRAM_BOT_TOKEN and TELEGRAM_WEBHOOK_SECRET — same manual-step pattern
 * as the Google/Microsoft OAuth app setup.
 */
export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "Set TELEGRAM_WEBHOOK_SECRET in your environment first." }, { status: 400 });
  }

  const webhookUrl = new URL("/api/webhooks/telegram", request.nextUrl.origin).toString();
  const result = await setTelegramWebhook(webhookUrl, secret);
  if (!result.ok) {
    return NextResponse.json({ error: result.description ?? "Failed to set webhook" }, { status: 502 });
  }
  return NextResponse.json({ ok: true, webhookUrl });
}
