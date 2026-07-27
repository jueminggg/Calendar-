"use client";

import { useState } from "react";
import type { CalendarEvent } from "./types";
import { SOURCE_COLORS, SOURCE_LABELS } from "@/lib/event-colors";

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
  const isReadOnly = Boolean(existing && !existing.editable);

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

  async function handleSave() {
    setError(null);
    if (!title.trim()) {
      setError("Title is required");
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
      onSaved();
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!existing) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/events/${existing.id}`, { method: "DELETE" });
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

        {isReadOnly && (
          <p className="text-xs bg-amber-50 text-amber-800 dark:bg-amber-950 dark:text-amber-300 rounded px-2 py-1.5">
            This event is synced from an external calendar. Edit it there — support for editing it here is coming
            later.
          </p>
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
              disabled={isReadOnly}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full rounded-md border border-gray-300 dark:border-gray-700 bg-transparent px-3 py-2 text-sm mt-1 disabled:opacity-60"
            />
          </div>

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              disabled={isReadOnly}
              checked={allDay}
              onChange={(e) => setAllDay(e.target.checked)}
            />
            All day
          </label>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-sm font-medium">Starts</label>
              <input
                disabled={isReadOnly}
                type={allDay ? "date" : "datetime-local"}
                value={allDay ? start.slice(0, 10) : start}
                onChange={(e) => setStart(e.target.value)}
                className="w-full rounded-md border border-gray-300 dark:border-gray-700 bg-transparent px-3 py-2 text-sm mt-1 disabled:opacity-60"
              />
            </div>
            <div>
              <label className="text-sm font-medium">Ends</label>
              <input
                disabled={isReadOnly}
                type={allDay ? "date" : "datetime-local"}
                value={allDay ? end.slice(0, 10) : end}
                onChange={(e) => setEnd(e.target.value)}
                className="w-full rounded-md border border-gray-300 dark:border-gray-700 bg-transparent px-3 py-2 text-sm mt-1 disabled:opacity-60"
              />
            </div>
          </div>

          <div>
            <label className="text-sm font-medium">Location</label>
            <input
              disabled={isReadOnly}
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              className="w-full rounded-md border border-gray-300 dark:border-gray-700 bg-transparent px-3 py-2 text-sm mt-1 disabled:opacity-60"
            />
          </div>

          <div>
            <label className="text-sm font-medium">Description</label>
            <textarea
              disabled={isReadOnly}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              className="w-full rounded-md border border-gray-300 dark:border-gray-700 bg-transparent px-3 py-2 text-sm mt-1 disabled:opacity-60"
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
          {existing && existing.editable ? (
            <button
              onClick={handleDelete}
              disabled={saving}
              className="text-sm text-red-600 dark:text-red-400 hover:underline disabled:opacity-50"
            >
              Delete
            </button>
          ) : (
            <span />
          )}
          {!isReadOnly && (
            <button
              onClick={handleSave}
              disabled={saving}
              className="rounded-md bg-black text-white dark:bg-white dark:text-black px-4 py-1.5 text-sm font-medium disabled:opacity-50"
            >
              {saving ? "Saving…" : "Save"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
