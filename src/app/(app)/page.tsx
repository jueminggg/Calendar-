"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import MonthGrid from "@/components/calendar/MonthGrid";
import TimeGridView from "@/components/calendar/TimeGridView";
import EventModal from "@/components/calendar/EventModal";
import ImportScreenshotModal from "@/components/calendar/ImportScreenshotModal";
import type { CalendarEvent } from "@/components/calendar/types";
import { SOURCE_COLORS, SOURCE_LABELS } from "@/lib/event-colors";

type ViewMode = "month" | "week" | "day";

function startOfDay(d: Date): Date {
  const r = new Date(d);
  r.setHours(0, 0, 0, 0);
  return r;
}
function addDays(d: Date, n: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}
function addMonths(d: Date, n: number): Date {
  const r = new Date(d);
  r.setMonth(r.getMonth() + n);
  return r;
}
function startOfWeek(d: Date): Date {
  const r = startOfDay(d);
  r.setDate(r.getDate() - r.getDay());
  return r;
}

export default function CalendarPage() {
  const [view, setView] = useState<ViewMode>("month");
  const [cursor, setCursor] = useState<Date>(() => startOfDay(new Date()));
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState<{ mode: "create"; date: Date } | { mode: "edit"; event: CalendarEvent } | null>(
    null,
  );
  const [showImportModal, setShowImportModal] = useState(false);
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [deleting, setDeleting] = useState(false);

  const { rangeFrom, rangeTo, weekDays } = useMemo(() => {
    if (view === "month") {
      const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
      return {
        rangeFrom: addDays(first, -7),
        rangeTo: addDays(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1), 7),
        weekDays: null as Date[] | null,
      };
    }
    if (view === "week") {
      const start = startOfWeek(cursor);
      return { rangeFrom: start, rangeTo: addDays(start, 7), weekDays: Array.from({ length: 7 }, (_, i) => addDays(start, i)) };
    }
    const start = startOfDay(cursor);
    return { rangeFrom: start, rangeTo: addDays(start, 1), weekDays: [start] };
  }, [view, cursor]);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch(`/api/events?from=${rangeFrom.toISOString()}&to=${rangeTo.toISOString()}`);
    if (res.ok) {
      const data = await res.json();
      setEvents(data.events);
    }
    setLoading(false);
  }, [rangeFrom, rangeTo]);

  useEffect(() => {
    load();
  }, [load]);

  function goToday() {
    setCursor(startOfDay(new Date()));
  }

  function toggleSelectMode() {
    setSelectMode((v) => !v);
    setSelectedIds(new Set());
  }

  function handleEventClick(event: CalendarEvent) {
    if (!selectMode) {
      setModal({ mode: "edit", event });
      return;
    }
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(event.id)) next.delete(event.id);
      else next.add(event.id);
      return next;
    });
  }

  async function deleteSelected() {
    if (selectedIds.size === 0) return;
    if (!window.confirm(`Delete ${selectedIds.size} event(s)? This can't be undone.`)) return;
    setDeleting(true);
    try {
      await Promise.allSettled(Array.from(selectedIds).map((id) => fetch(`/api/events/${id}`, { method: "DELETE" })));
      setSelectedIds(new Set());
      setSelectMode(false);
      await load();
    } finally {
      setDeleting(false);
    }
  }

  async function deleteAllNative() {
    if (!window.confirm('Delete ALL "This app" (native) events, across every date? This can\'t be undone.')) return;
    setDeleting(true);
    try {
      const res = await fetch("/api/events/native", { method: "DELETE" });
      if (res.ok) {
        const data = await res.json();
        window.alert(`Deleted ${data.count} event(s).`);
      }
      await load();
    } finally {
      setDeleting(false);
    }
  }

  function goPrev() {
    if (view === "month") setCursor((c) => addMonths(new Date(c.getFullYear(), c.getMonth(), 1), -1));
    else if (view === "week") setCursor((c) => addDays(c, -7));
    else setCursor((c) => addDays(c, -1));
  }
  function goNext() {
    if (view === "month") setCursor((c) => addMonths(new Date(c.getFullYear(), c.getMonth(), 1), 1));
    else if (view === "week") setCursor((c) => addDays(c, 7));
    else setCursor((c) => addDays(c, 1));
  }

  const headerLabel = useMemo(() => {
    if (view === "month") return cursor.toLocaleDateString(undefined, { month: "long", year: "numeric" });
    if (view === "week" && weekDays) {
      const start = weekDays[0];
      const end = weekDays[6];
      const sameMonth = start.getMonth() === end.getMonth();
      const startLabel = start.toLocaleDateString(undefined, { month: "short", day: "numeric" });
      const endLabel = end.toLocaleDateString(
        undefined,
        sameMonth ? { day: "numeric", year: "numeric" } : { month: "short", day: "numeric", year: "numeric" },
      );
      return `${startLabel} – ${endLabel}`;
    }
    return cursor.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric" });
  }, [view, cursor, weekDays]);

  return (
    <div className="p-4 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <h1 className="text-xl font-semibold min-w-48">{headerLabel}</h1>
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
          <div className="flex rounded-md border border-gray-300 dark:border-gray-700 overflow-hidden text-sm">
            {(["month", "week", "day"] as ViewMode[]).map((v) => (
              <button
                key={v}
                onClick={() => setView(v)}
                className={`px-3 py-1.5 capitalize ${
                  view === v
                    ? "bg-black text-white dark:bg-white dark:text-black"
                    : "hover:bg-gray-50 dark:hover:bg-gray-800"
                }`}
              >
                {v}
              </button>
            ))}
          </div>
          {selectMode ? (
            <>
              <button
                onClick={deleteSelected}
                disabled={selectedIds.size === 0 || deleting}
                className="rounded-md bg-red-600 text-white px-3 py-1.5 text-sm font-medium disabled:opacity-50"
              >
                {deleting ? "Deleting…" : `Delete (${selectedIds.size})`}
              </button>
              <button
                onClick={toggleSelectMode}
                className="rounded-md border border-gray-300 dark:border-gray-700 px-3 py-1.5 text-sm font-medium hover:bg-gray-50 dark:hover:bg-gray-800"
              >
                Cancel
              </button>
            </>
          ) : (
            <>
              <button
                onClick={toggleSelectMode}
                className="rounded-md border border-gray-300 dark:border-gray-700 px-3 py-1.5 text-sm font-medium hover:bg-gray-50 dark:hover:bg-gray-800"
              >
                Select
              </button>
              <button
                onClick={deleteAllNative}
                disabled={deleting}
                className="text-sm text-red-600 dark:text-red-400 hover:underline disabled:opacity-50"
                title='Delete every "This app" (native) event, across all dates'
              >
                {deleting ? "Deleting…" : "Clear all native"}
              </button>
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
            </>
          )}
        </div>
      </div>

      {selectMode && (
        <p className="text-xs text-gray-500 mb-3">Tap events to select them, then Delete. Tap Cancel to stop.</p>
      )}

      {loading && events.length === 0 ? (
        <p className="text-sm text-gray-500">Loading…</p>
      ) : view === "month" ? (
        <MonthGrid
          year={cursor.getFullYear()}
          month={cursor.getMonth()}
          events={events}
          onDayClick={(date) => !selectMode && setModal({ mode: "create", date })}
          onEventClick={handleEventClick}
          selectedIds={selectMode ? selectedIds : undefined}
        />
      ) : (
        <TimeGridView
          days={weekDays ?? [cursor]}
          events={events}
          onSlotClick={(date) => !selectMode && setModal({ mode: "create", date })}
          onEventClick={handleEventClick}
          selectedIds={selectMode ? selectedIds : undefined}
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
