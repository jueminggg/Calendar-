"use client";

import { useEffect, useState, useCallback } from "react";
import MonthGrid from "@/components/calendar/MonthGrid";
import EventModal from "@/components/calendar/EventModal";
import ImportScreenshotModal from "@/components/calendar/ImportScreenshotModal";
import type { CalendarEvent } from "@/components/calendar/types";
import { SOURCE_COLORS, SOURCE_LABELS } from "@/lib/event-colors";

export default function CalendarPage() {
  const [cursor, setCursor] = useState(() => {
    const now = new Date();
    return { year: now.getFullYear(), month: now.getMonth() };
  });
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState<{ mode: "create"; date: Date } | { mode: "edit"; event: CalendarEvent } | null>(
    null,
  );
  const [showImportModal, setShowImportModal] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const from = new Date(cursor.year, cursor.month, 1);
    from.setDate(from.getDate() - 7);
    const to = new Date(cursor.year, cursor.month + 1, 1);
    to.setDate(to.getDate() + 7);

    const res = await fetch(`/api/events?from=${from.toISOString()}&to=${to.toISOString()}`);
    if (res.ok) {
      const data = await res.json();
      setEvents(data.events);
    }
    setLoading(false);
  }, [cursor]);

  useEffect(() => {
    load();
  }, [load]);

  function goToday() {
    const now = new Date();
    setCursor({ year: now.getFullYear(), month: now.getMonth() });
  }
  function goPrev() {
    setCursor((c) => (c.month === 0 ? { year: c.year - 1, month: 11 } : { year: c.year, month: c.month - 1 }));
  }
  function goNext() {
    setCursor((c) => (c.month === 11 ? { year: c.year + 1, month: 0 } : { year: c.year, month: c.month + 1 }));
  }

  const monthLabel = new Date(cursor.year, cursor.month, 1).toLocaleDateString(undefined, {
    month: "long",
    year: "numeric",
  });

  return (
    <div className="p-4 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <h1 className="text-xl font-semibold w-48">{monthLabel}</h1>
          <button onClick={goPrev} className="px-2 py-1 rounded-md hover:bg-gray-100 dark:hover:bg-gray-800 text-sm">
            ←
          </button>
          <button onClick={goToday} className="px-2 py-1 rounded-md hover:bg-gray-100 dark:hover:bg-gray-800 text-sm">
            Today
          </button>
          <button onClick={goNext} className="px-2 py-1 rounded-md hover:bg-gray-100 dark:hover:bg-gray-800 text-sm">
            →
          </button>
        </div>

        <div className="flex items-center gap-3">
          <div className="hidden sm:flex items-center gap-3 text-xs text-gray-500">
            {Object.entries(SOURCE_LABELS).map(([source, label]) => (
              <span key={source} className="flex items-center gap-1">
                <span className="w-2 h-2 rounded-full inline-block" style={{ backgroundColor: SOURCE_COLORS[source] }} />
                {label}
              </span>
            ))}
          </div>
          <button
            onClick={() => setShowImportModal(true)}
            className="rounded-md border border-gray-300 dark:border-gray-700 px-3 py-1.5 text-sm font-medium hover:bg-gray-50 dark:hover:bg-gray-800"
          >
            Import screenshot
          </button>
          <button
            onClick={() => setModal({ mode: "create", date: new Date() })}
            className="rounded-md bg-black text-white dark:bg-white dark:text-black px-3 py-1.5 text-sm font-medium"
          >
            + New event
          </button>
        </div>
      </div>

      {loading && events.length === 0 ? (
        <p className="text-sm text-gray-500">Loading…</p>
      ) : (
        <MonthGrid
          year={cursor.year}
          month={cursor.month}
          events={events}
          onDayClick={(date) => setModal({ mode: "create", date })}
          onEventClick={(event) => setModal({ mode: "edit", event })}
        />
      )}

      {modal?.mode === "create" && (
        <EventModal initialDate={modal.date} onClose={() => setModal(null)} onSaved={() => (setModal(null), load())} />
      )}
      {modal?.mode === "edit" && (
        <EventModal
          existing={modal.event}
          onClose={() => setModal(null)}
          onSaved={() => (setModal(null), load())}
          onDeleted={() => (setModal(null), load())}
        />
      )}

      {showImportModal && (
        <ImportScreenshotModal
          onClose={() => setShowImportModal(false)}
          onImported={() => {
            setShowImportModal(false);
            load();
          }}
        />
      )}
    </div>
  );
}
