"use client";

import { useEffect, useState } from "react";
import type { CalendarEvent } from "./types";
import { SOURCE_COLORS, SOURCE_LABELS } from "@/lib/event-colors";
import { describeRecurrence } from "@/lib/recurrence";

type CalendarOption = { id: string; name: string; provider: "GOOGLE" | "MICROSOFT" | "APPLE" };
type RepeatFreq = "NONE" | "DAILY" | "WEEKLY" | "MONTHLY" | "YEARLY";

function defaultUntil(): string {
  const d = new Date();
  d.setMonth(d.getMonth() + 3);
  return d.toISOString().slice(0, 10);
}

function toLocalInputValue(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function EventModal({
  initialDate,
  existing,
  onClose,
  onSaved,
  onDeleted,
}: {
  initialDate?: Date;
  existing?: CalendarEvent;
  onClose: () => void;
  onSaved: () => void;
  onDeleted?: () => void;
}) {
  const defaultStart = existing ? new Date(existing.startAt) : (initialDate ?? new Date());
  const defaultEnd = existing
    ? new Date(existing.endAt)
    : new Date((initialDate ?? new Date()).getTime() + 60 * 60 * 1000);

  const [title, setTitle] = useState(existing?.title ?? "");
  const [location, setLocation] = useState(existing?.location ?? "");
  const [description, setDescription] = useState(existing?.description ?? "");
  const [allDay, setAllDay] = useState(existing?.allDay ?? false);
  const [start, setStart] = useState(toLocalInputValue(defaultStart.toISOString()));
  const [end, setEnd] = useState(toLocalInputValue(defaultEnd.toISOString()));
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [calendarOptions, setCalendarOptions] = useState<CalendarOption[]>([]);
  const [selectedTargets, setSelectedTargets] = useState<Set<string>>(new Set(["native"]));
  const [repeatFreq, setRepeatFreq] = useState<RepeatFreq>("NONE");
  const [repeatEndType, setRepeatEndType] = useState<"count" | "until">("count");
  const [repeatCount, setRepeatCount] = useState(10);
  const [repeatUntil, setRepeatUntil] = useState(defaultUntil);

  function toggleTarget(id: string) {
    setSelectedTargets((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function handleRepeatFreqChange(freq: RepeatFreq) {
    setRepeatFreq(freq);
    // Write-back for recurring series isn't built for external providers yet,
    // so recurring events can only be created natively.
    if (freq !== "NONE") setSelectedTargets(new Set(["native"]));
  }

  useEffect(() => {
    if (existing) return; // calendar picker only applies to new events
    fetch("/api/connections")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!data) return;
        const options: CalendarOption[] = data.connections.flatMap(
          (c: { provider: CalendarOption["provider"]; status: string; calendars: { id: string; name: string; enabled: boolean }[] }) =>
            c.status === "ACTIVE"
              ? c.calendars.filter((cal) => cal.enabled).map((cal) => ({ id: cal.id, name: cal.name, provider: c.provider }))
              : [],
        );
        setCalendarOptions(options);
      })
      .catch(() => {});
  }, [existing]);

  async function handleSave() {
    setError(null);
    if (!title.trim()) {
      setError("Title is required");
      return;
    }
    if (!existing && selectedTargets.size === 0) {
      setError("Choose at least one calendar to add this to");
      return;
    }
    setSaving(true);
    try {
      const payload = {
        title: title.trim(),
        description: description || undefined,
        location: location || undefined,
        startAt: new Date(start).toISOString(),
        endAt: new Date(end).toISOString(),
        allDay,
        ...(existing
          ? {}
          : {
              targets: Array.from(selectedTargets),
              ...(repeatFreq !== "NONE"
                ? {
                    recurrence: {
                      freq: repeatFreq,
                      ...(repeatEndType === "count"
                        ? { count: repeatCount }
                        : { until: new Date(repeatUntil).toISOString() }),
                    },
                  }
                : {}),
            }),
      };
      const res = await fetch(existing ? `/api/events/${existing.id}` : "/api/events", {
        method: existing ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Something went wrong");
        return;
      }
      if (data.errors?.length) {
        window.alert(`Added, but some calendars failed:\n${data.errors.join("\n")}`);
      }
      onSaved();
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(scope?: "series") {
    if (!existing) return;
    if (scope === "series" && !window.confirm("Delete every event in this series? This can't be undone.")) return;
    setSaving(true);
    try {
      const url = `/api/events/${existing.id}${scope === "series" ? "?scope=series" : ""}`;
      const res = await fetch(url, { method: "DELETE" });
      if (res.ok) onDeleted?.();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-30 p-4" onClick={onClose}>
      <div
        className="w-full max-w-md rounded-lg bg-white dark:bg-gray-900 shadow-xl p-5 space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">{existing ? "Event" : "New event"}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">
            &times;
          </button>
        </div>

        {existing && (
          <div className="flex items-center gap-2 text-xs text-gray-500">
            <span
              className="w-2 h-2 rounded-full inline-block"
              style={{ backgroundColor: existing.calendarColor ?? SOURCE_COLORS[existing.source] }}
            />
            {SOURCE_LABELS[existing.source]}
            {existing.connectionLabel ? ` · ${existing.connectionLabel}` : ""}
          </div>
        )}

        {existing && existing.source !== "NATIVE" && (
          <p className="text-xs bg-blue-50 text-blue-800 dark:bg-blue-950 dark:text-blue-300 rounded px-2 py-1.5">
            Changes here are saved back to {SOURCE_LABELS[existing.source]} too.
          </p>
        )}

        {existing && describeRecurrence(existing.recurrenceRule) && (
          <p className="text-xs text-gray-500">{describeRecurrence(existing.recurrenceRule)}</p>
        )}

        {!existing && (
          <div>
            <label className="text-sm font-medium">Add to</label>
            <div className="mt-1 space-y-1 rounded-md border border-gray-300 dark:border-gray-700 p-2 max-h-32 overflow-y-auto">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={selectedTargets.has("native")}
                  onChange={() => toggleTarget("native")}
                />
                This app only (native)
              </label>
              {calendarOptions.map((opt) => (
                <label
                  key={opt.id}
                  className={`flex items-center gap-2 text-sm ${repeatFreq !== "NONE" ? "opacity-40" : ""}`}
                >
                  <input
                    type="checkbox"
                    disabled={repeatFreq !== "NONE"}
                    checked={selectedTargets.has(opt.id)}
                    onChange={() => toggleTarget(opt.id)}
                  />
                  {opt.name} ({SOURCE_LABELS[opt.provider]})
                </label>
              ))}
            </div>
            <p className="text-xs text-gray-400 mt-1">
              {repeatFreq !== "NONE"
                ? "Recurring events can only be added natively for now."
                : "Select more than one to add this event to several calendars at once."}
            </p>
          </div>
        )}

        {error && (
          <div className="rounded-md bg-red-50 text-red-700 text-sm px-3 py-2 dark:bg-red-950 dark:text-red-300">
            {error}
          </div>
        )}

        <div className="space-y-3">
          <div>
            <label className="text-sm font-medium" htmlFor="event-title">
              Title
            </label>
            <input
              id="event-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full rounded-md border border-gray-300 dark:border-gray-700 bg-transparent px-3 py-2 text-sm mt-1"
            />
          </div>

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={allDay}
              onChange={(e) => setAllDay(e.target.checked)}
            />
            All day
          </label>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-sm font-medium">Starts</label>
              <input
                type={allDay ? "date" : "datetime-local"}
                value={allDay ? start.slice(0, 10) : start}
                onChange={(e) => setStart(e.target.value)}
                className="w-full rounded-md border border-gray-300 dark:border-gray-700 bg-transparent px-3 py-2 text-sm mt-1"
              />
            </div>
            <div>
              <label className="text-sm font-medium">Ends</label>
              <input
                type={allDay ? "date" : "datetime-local"}
                value={allDay ? end.slice(0, 10) : end}
                onChange={(e) => setEnd(e.target.value)}
                className="w-full rounded-md border border-gray-300 dark:border-gray-700 bg-transparent px-3 py-2 text-sm mt-1"
              />
            </div>
          </div>

          {!existing && (
            <div>
              <label className="text-sm font-medium">Repeats</label>
              <select
                value={repeatFreq}
                onChange={(e) => handleRepeatFreqChange(e.target.value as RepeatFreq)}
                className="w-full rounded-md border border-gray-300 dark:border-gray-700 bg-transparent px-3 py-2 text-sm mt-1"
              >
                <option value="NONE">Does not repeat</option>
                <option value="DAILY">Daily</option>
                <option value="WEEKLY">Weekly</option>
                <option value="MONTHLY">Monthly</option>
                <option value="YEARLY">Yearly</option>
              </select>

              {repeatFreq !== "NONE" && (
                <div className="flex items-center gap-2 mt-2 text-sm">
                  <span className="text-gray-500">Ends</span>
                  <select
                    value={repeatEndType}
                    onChange={(e) => setRepeatEndType(e.target.value as "count" | "until")}
                    className="rounded-md border border-gray-300 dark:border-gray-700 bg-transparent px-2 py-1.5 text-sm"
                  >
                    <option value="count">after</option>
                    <option value="until">on date</option>
                  </select>
                  {repeatEndType === "count" ? (
                    <>
                      <input
                        type="number"
                        min={1}
                        max={365}
                        value={repeatCount}
                        onChange={(e) => setRepeatCount(Math.max(1, Math.min(365, Number(e.target.value) || 1)))}
                        className="w-16 rounded-md border border-gray-300 dark:border-gray-700 bg-transparent px-2 py-1.5 text-sm"
                      />
                      <span className="text-gray-500">times</span>
                    </>
                  ) : (
                    <input
                      type="date"
                      value={repeatUntil}
                      onChange={(e) => setRepeatUntil(e.target.value)}
                      className="rounded-md border border-gray-300 dark:border-gray-700 bg-transparent px-2 py-1.5 text-sm"
                    />
                  )}
                </div>
              )}
            </div>
          )}

          <div>
            <label className="text-sm font-medium">Location</label>
            <input
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              className="w-full rounded-md border border-gray-300 dark:border-gray-700 bg-transparent px-3 py-2 text-sm mt-1"
            />
          </div>

          <div>
            <label className="text-sm font-medium">Description</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              className="w-full rounded-md border border-gray-300 dark:border-gray-700 bg-transparent px-3 py-2 text-sm mt-1"
            />
          </div>

          {existing?.attendees && existing.attendees.length > 0 && (
            <div>
              <label className="text-sm font-medium">Attendees</label>
              <ul className="text-sm text-gray-500 mt-1 space-y-0.5">
                {existing.attendees.map((a) => (
                  <li key={a.email}>
                    {a.name ?? a.email} {a.responseStatus ? `(${a.responseStatus})` : ""}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        <div className="flex justify-between pt-2">
          {existing ? (
            <div className="flex gap-3">
              <button
                onClick={() => handleDelete()}
                disabled={saving}
                className="text-sm text-red-600 dark:text-red-400 hover:underline disabled:opacity-50"
              >
                Delete
              </button>
              {existing.source === "NATIVE" && existing.recurringEventId && (
                <button
                  onClick={() => handleDelete("series")}
                  disabled={saving}
                  className="text-sm text-red-600 dark:text-red-400 hover:underline disabled:opacity-50"
                >
                  Delete all in series
                </button>
              )}
            </div>
          ) : (
            <span />
          )}
          <button
            onClick={handleSave}
            disabled={saving}
            className="rounded-md bg-pink-600 text-white hover:bg-pink-700 dark:bg-pink-600 dark:hover:bg-pink-700 px-4 py-1.5 text-sm font-medium disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
