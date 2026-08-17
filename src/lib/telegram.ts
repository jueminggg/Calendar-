const API_BASE = "https://api.telegram.org";

function botToken(): string | null {
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
  return token || null;
}

/** Telegram is optional — until TELEGRAM_BOT_TOKEN is set, calls here are a silent no-op (same pattern as VAPID keys in push.ts). */
export function isTelegramConfigured(): boolean {
  return botToken() !== null;
}

export async function sendTelegramMessage(chatId: string, text: string): Promise<boolean> {
  const token = botToken();
  if (!token) return false;
  try {
    const res = await fetch(`${API_BASE}/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }),
    });
    if (!res.ok) {
      console.error("Telegram sendMessage failed", res.status, await res.text().catch(() => ""));
      return false;
    }
    return true;
  } catch (err) {
    console.error("Telegram sendMessage error", err);
    return false;
  }
}

export type InlineButton = { text: string; callback_data: string };

/** Sends a message with tappable inline buttons below it (e.g. "Create anyway" / "Cancel"). */
export async function sendTelegramMessageWithButtons(
  chatId: string,
  text: string,
  buttons: InlineButton[][],
): Promise<boolean> {
  const token = botToken();
  if (!token) return false;
  try {
    const res = await fetch(`${API_BASE}/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        disable_web_page_preview: true,
        reply_markup: { inline_keyboard: buttons },
      }),
    });
    if (!res.ok) {
      console.error("Telegram sendMessage (buttons) failed", res.status, await res.text().catch(() => ""));
      return false;
    }
    return true;
  } catch (err) {
    console.error("Telegram sendMessage (buttons) error", err);
    return false;
  }
}

/** Dismisses the loading spinner on a tapped inline button; optionally shows a small toast in Telegram. */
export async function answerCallbackQuery(callbackQueryId: string, text?: string): Promise<void> {
  const token = botToken();
  if (!token) return;
  try {
    await fetch(`${API_BASE}/bot${token}/answerCallbackQuery`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ callback_query_id: callbackQueryId, text }),
    });
  } catch (err) {
    console.error("Telegram answerCallbackQuery error", err);
  }
}

export async function setTelegramWebhook(
  url: string,
  secretToken: string,
): Promise<{ ok: boolean; description?: string }> {
  const token = botToken();
  if (!token) return { ok: false, description: "TELEGRAM_BOT_TOKEN is not set" };
  const res = await fetch(`${API_BASE}/bot${token}/setWebhook`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url, secret_token: secretToken, allowed_updates: ["message", "callback_query"] }),
  });
  const data = (await res.json().catch(() => ({}))) as { ok?: boolean; description?: string };
  return { ok: Boolean(data.ok), description: data.description };
}
