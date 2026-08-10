"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import PushToggle from "@/components/PushToggle";

type TelegramSettings = {
  linked: boolean;
  telegramMorningAgendaEnabled: boolean;
  telegramMorningAgendaTime: string;
  telegramEveningAgendaEnabled: boolean;
  telegramEveningAgendaTime: string;
};

function TelegramSection() {
  const [settings, setSettings] = useState<TelegramSettings | null>(null);
  const [linkUrl, setLinkUrl] = useState<string | null>(null);
  const [linking, setLinking] = useState(false);
  const [saving, setSaving] = useState(false);
  const pollRef = useRef<number | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/settings/telegram");
    if (res.ok) setSettings(await res.json());
  }, []);

  useEffect(() => {
    load();
    return () => {
      if (pollRef.current !== null) window.clearInterval(pollRef.current);
    };
  }, [load]);

  const botUsername = process.env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME;

  async function startLink() {
    setLinking(true);
    try {
      const res = await fetch("/api/settings/telegram/link-code", { method: "POST" });
      if (!res.ok) return;
      const data = await res.json();
      setLinkUrl(`https://t.me/${botUsername}?start=${data.code}`);
      if (pollRef.current !== null) window.clearInterval(pollRef.current);
      pollRef.current = window.setInterval(async () => {
        const check = await fetch("/api/settings/telegram");
        if (check.ok) {
          const fresh = await check.json();
          setSettings(fresh);
          if (fresh.linked && pollRef.current !== null) {
            window.clearInterval(pollRef.current);
            pollRef.current = null;
            setLinkUrl(null);
          }
        }
      }, 3000);
    } finally {
      setLinking(false);
    }
  }

  async function unlink() {
    await fetch("/api/settings/telegram", { method: "DELETE" });
    await load();
  }

  async function saveAgenda(next: TelegramSettings) {
    setSettings(next);
    setSaving(true);
    try {
      await fetch("/api/settings/telegram", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          telegramMorningAgendaEnabled: next.telegramMorningAgendaEnabled,
          telegramMorningAgendaTime: next.telegramMorningAgendaTime,
          telegramEveningAgendaEnabled: next.telegramEveningAgendaEnabled,
          telegramEveningAgendaTime: next.telegramEveningAgendaTime,
        }),
      });
    } finally {
      setSaving(false);
    }
  }

  if (!settings) return null;

  return (
    <div className="space-y-3 border-t border-gray-200 dark:border-gray-800 pt-4">
      <h2 className="text-sm font-medium">Telegram</h2>
      <p className="text-xs text-gray-500">
        Get today&apos;s and tomorrow&apos;s agenda, plus any event reminders, sent to Telegram with details like
        location included.
      </p>

      {settings.linked ? (
        <div className="flex items-center gap-3">
          <span className="text-sm text-green-600 dark:text-green-400">✓ Linked</span>
          <button onClick={unlink} className="text-sm text-red-600 dark:text-red-400 hover:underline">
            Unlink
          </button>
        </div>
      ) : !botUsername ? (
        <p className="text-xs text-gray-400">Telegram isn&apos;t set up on this deployment yet.</p>
      ) : linkUrl ? (
        <div className="space-y-1">
          <a
            href={linkUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-block rounded-md bg-pink-600 text-white hover:bg-pink-700 px-4 py-1.5 text-sm font-medium"
          >
            Open Telegram to finish linking
          </a>
          <p className="text-xs text-gray-400">Waiting for you to tap Start in Telegram… this code expires in 15 minutes.</p>
        </div>
      ) : (
        <button
          onClick={startLink}
          disabled={linking}
          className="rounded-md border border-gray-300 dark:border-gray-700 px-3 py-1.5 text-sm font-medium hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-50"
        >
          {linking ? "Generating…" : "Link Telegram"}
        </button>
      )}

      {settings.linked && (
        <div className="grid grid-cols-2 gap-3 pt-2">
          <div>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={settings.telegramMorningAgendaEnabled}
                onChange={(e) => saveAgenda({ ...settings, telegramMorningAgendaEnabled: e.target.checked })}
              />
              Today&apos;s agenda
            </label>
            <input
              type="time"
              value={settings.telegramMorningAgendaTime}
              onChange={(e) => saveAgenda({ ...settings, telegramMorningAgendaTime: e.target.value })}
              className="w-full rounded-md border border-gray-300 dark:border-gray-700 bg-transparent px-3 py-2 text-sm mt-1"
            />
          </div>
          <div>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={settings.telegramEveningAgendaEnabled}
                onChange={(e) => saveAgenda({ ...settings, telegramEveningAgendaEnabled: e.target.checked })}
              />
              Tomorrow&apos;s agenda
            </label>
            <input
              type="time"
              value={settings.telegramEveningAgendaTime}
              onChange={(e) => saveAgenda({ ...settings, telegramEveningAgendaTime: e.target.value })}
              className="w-full rounded-md border border-gray-300 dark:border-gray-700 bg-transparent px-3 py-2 text-sm mt-1"
            />
          </div>
          {saving && <span className="text-xs text-gray-400 col-span-2">Saving…</span>}
        </div>
      )}
    </div>
  );
}

export default function NotificationSettingsPage() {
  const [enabled, setEnabled] = useState(false);
  const [morning, setMorning] = useState("07:00");
  const [evening, setEvening] = useState("20:00");
  const [timezone, setTimezone] = useState("UTC");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    fetch("/api/settings/notifications")
      .then((res) => res.json())
      .then((data) => {
        setEnabled(data.remindersEnabled);
        setMorning(data.morningReminderTime);
        setEvening(data.eveningReminderTime);
        setTimezone(data.timezone);
      })
      .finally(() => setLoading(false));
  }, []);

  async function save() {
    setSaving(true);
    setSaved(false);
    try {
      await fetch("/api/settings/notifications", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          remindersEnabled: enabled,
          morningReminderTime: morning,
          eveningReminderTime: evening,
        }),
      });
      setSaved(true);
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <div className="p-4 max-w-lg mx-auto text-sm text-gray-500">Loading…</div>;

  return (
    <div className="p-4 max-w-lg mx-auto space-y-6">
      <h1 className="text-xl font-semibold">Notifications</h1>

      <div className="space-y-2">
        <h2 className="text-sm font-medium">Push notifications</h2>
        <p className="text-xs text-gray-500">
          Get invite/edit alerts and daily reminders sent to this device, even when the app isn&apos;t open.
        </p>
        <PushToggle />
      </div>

      <div className="space-y-3 border-t border-gray-200 dark:border-gray-800 pt-4">
        <h2 className="text-sm font-medium">Daily planning reminders</h2>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
          Remind me to plan my day every morning, and check off at night
        </label>

        {enabled && (
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-sm font-medium">Morning reminder</label>
              <input
                type="time"
                value={morning}
                onChange={(e) => setMorning(e.target.value)}
                className="w-full rounded-md border border-gray-300 dark:border-gray-700 bg-transparent px-3 py-2 text-sm mt-1"
              />
            </div>
            <div>
              <label className="text-sm font-medium">Evening check-off</label>
              <input
                type="time"
                value={evening}
                onChange={(e) => setEvening(e.target.value)}
                className="w-full rounded-md border border-gray-300 dark:border-gray-700 bg-transparent px-3 py-2 text-sm mt-1"
              />
            </div>
          </div>
        )}

        <p className="text-xs text-gray-400">
          Times are in your account&apos;s timezone ({timezone}). Reminders only reach this device if push
          notifications are enabled above.
        </p>

        <div className="flex items-center gap-2">
          <button
            onClick={save}
            disabled={saving}
            className="rounded-md bg-pink-600 text-white hover:bg-pink-700 dark:bg-pink-600 dark:hover:bg-pink-700 px-4 py-1.5 text-sm font-medium disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save"}
          </button>
          {saved && <span className="text-sm text-green-600 dark:text-green-400">Saved</span>}
        </div>
      </div>

      <TelegramSection />
    </div>
  );
}
