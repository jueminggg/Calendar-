"use client";

import { useEffect, useState } from "react";
import PushToggle from "@/components/PushToggle";

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
            className="rounded-md bg-black text-white dark:bg-white dark:text-black px-4 py-1.5 text-sm font-medium disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save"}
          </button>
          {saved && <span className="text-sm text-green-600 dark:text-green-400">Saved</span>}
        </div>
      </div>
    </div>
  );
}
