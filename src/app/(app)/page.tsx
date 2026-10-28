"use client";

import { useEffect, useState, useCallback, useMemo, useRef, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import MonthGrid from "@/components/calendar/MonthGrid";
import TimeGridView from "@/components/calendar/TimeGridView";
import EventModal from "@/components/calendar/EventModal";
import ImportScreenshotModal from "@/components/calendar/ImportScreenshotModal";
import CalendarSidebar from "@/components/calendar/CalendarSidebar";
import type { CalendarEvent } from "@/components/calendar/types";
import {
  ALL_FILTER_KEYS,
  eventFilterKey,
  getFiltersServerSnapshot,
  getFiltersSnapshot,
  setStoredFilters,
  subscribeFilters,
  type FilterKey,
} from "@/lib/event-filters";

type ViewMode = "month" | "week" | "day";

const VIEW_LABELS: Record<ViewMode, string> = { day: "Daily", week: "Weekly", month: "Monthly" };

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
function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

export default function CalendarPage() {
  const [view, setView] = useState<ViewMode>("month");
  const [cursor, setCursor] = useState<Date>(() => startOfDay(new Date()));
  const router = useRouter();
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState<{ mode: "create"; date: Date } | { mode: "edit"; event: CalendarEvent } | null>(
    null,
  );
  const [showImportModal, setShowImportModal] = useState(false);
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [deleting, setDeleting] = useState(false);

  const filters = useSyncExternalStore(subscribeFilters, getFiltersSnapshot, getFiltersServerSnapshot);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  function toggleFilter(key: FilterKey) {
    setStoredFilters(filters.includes(key) ? filters.filter((k) => k !== key) : [...filters, key]);
  }

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

  // Filtering happens here rather than in the request: the range is already
  // loaded, so ticking a box is instant and costs no round trip -- and on a
  // database billed by the hour it stays awake for, that matters.
  const visibleEvents = useMemo(
    () => events.filter((e) => filters.includes(eventFilterKey(e))),
    [events, filters],
  );

  const counts = useMemo(() => {
    const tally = Object.fromEntries(ALL_FILTER_KEYS.map((k) => [k, 0])) as Record<FilterKey, number>;
    for (const e of events) tally[eventFilterKey(e)]++;
    return tally;
  }, [events]);

  // A hidden event can still be in selectedIds if it was ticked before the
  // filter changed. Deleting what you can no longer see would be the worst
  // kind of surprise, so the visible subset is what Delete acts on and counts.
  const selectedVisibleIds = useMemo(
    () => visibleEvents.filter((e) => selectedIds.has(e.id)).map((e) => e.id),
    [visibleEvents, selectedIds],
  );

  function goToday() {
    setCursor(startOfDay(new Date()));
  }

  function toggleSelectMode() {
    setSelectMode((v) => !v);
    setSelectedIds(new Set());
  }

  function handleEventClick(event: CalendarEvent) {
    // A to-do only looks like an event here. It has no Event row behind it, so
    // neither the editor nor select-and-delete can act on it -- send you to
    // where it actually lives instead.
    if (event.kind === "task") {
      router.push("/todo");
      return;
    }
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
    if (selectedVisibleIds.length === 0) return;
    if (!window.confirm(`Delete ${selectedVisibleIds.length} event(s)? This can't be undone.`)) return;
    setDeleting(true);
    try {
      await Promise.allSettled(selectedVisibleIds.map((id) => fetch(`/api/events/${id}`, { method: "DELETE" })));
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

  function handleDayClick(date: Date) {
    if (selectMode) return;
    setView("day");
    setCursor(startOfDay(date));
  }

  /** What "Create event" should default to — the day currently being viewed, not always today. */
  function defaultNewEventDate(): Date {
    const now = new Date();
    if (view === "month") {
      if (now.getFullYear() === cursor.getFullYear() && now.getMonth() === cursor.getMonth()) return now;
      return new Date(cursor.getFullYear(), cursor.getMonth(), 1, 9, 0, 0, 0);
    }
    if (isSameDay(cursor, now)) return now;
    const d = new Date(cursor);
    d.setHours(9, 0, 0, 0);
    return d;
  }

  async function handleEventReschedule(event: CalendarEvent, newStart: Date, newEnd: Date) {
    const previous = events;
    setEvents((prev) => prev.map((e) => (e.id === event.id ? { ...e, startAt: newStart.toISOString(), endAt: newEnd.toISOString() } : e)));
    try {
      const res = await fetch(`/api/events/${event.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ startAt: newStart.toISOString(), endAt: newEnd.toISOString() }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        setEvents(previous);
        window.alert(data?.error ?? "Couldn't move that event.");
      } else {
        await load();
      }
    } catch {
      setEvents(previous);
      window.alert("Couldn't move that event.");
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
      const startLabel = start.toLocaleDateString(undefined, { month: "short", day: "numeric" });
      // Always include the month here even when start/end share one — omitting
      // it (passing just { day, year }) is ambiguous per the Intl spec and some
      // engines render a garbled fallback instead of a plain date.
      const endLabel = end.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
      return `${startLabel} – ${endLabel}`;
    }
    return cursor.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric" });
  }, [view, cursor, weekDays]);

  const sidebar = (
    <CalendarSidebar
      cursor={cursor}
      onPickDate={(date) => {
        setCursor(date);
        setSidebarOpen(false);
      }}
      filters={filters}
      onToggleFilter={toggleFilter}
      counts={counts}
    />
  );

  const iconButton =
    "h-9 w-9 rounded-full flex items-center justify-center text-sm hover:bg-gray-100 dark:hover:bg-gray-800";
  const menuItem = "block w-full text-left px-3 py-2 text-sm hover:bg-gray-100 dark:hover:bg-gray-800";

  return (
    <div className="p-3 sm:p-5 max-w-7xl mx-auto">
      <div className="lg:grid lg:grid-cols-[260px_minmax(0,1fr)] lg:gap-5">
        <aside className="hidden lg:block">{sidebar}</aside>

        <main className="min-w-0">
          <div className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-3 sm:p-4">
            <div className="flex items-center justify-between gap-2 flex-wrap mb-3">
              <div className="flex items-center gap-0.5 sm:gap-1 min-w-0 flex-1 basis-full sm:basis-auto">
                <button
                  onClick={() => setSidebarOpen(true)}
                  className={`lg:hidden shrink-0 ${iconButton}`}
                  aria-label="Open calendars and filters"
                >
                  ☰
                </button>
                <button onClick={goPrev} className={`shrink-0 ${iconButton}`} aria-label="Previous">
                  ‹
                </button>
                {/* min-w-0 as well as on the row: a flex item will not shrink
                    below its content width without it, so truncate never
                    engages and the row pushes the controls off-screen. */}
                <h1 className="text-sm sm:text-lg font-semibold truncate min-w-0 px-1">{headerLabel}</h1>
                <button onClick={goNext} className={`shrink-0 ${iconButton}`} aria-label="Next">
                  ›
                </button>
                <button
                  onClick={goToday}
                  className="ml-0.5 shrink-0 px-2.5 sm:px-3 py-1.5 rounded-full text-xs font-medium border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800"
                >
                  Today
                </button>
              </div>

              <div className="flex items-center gap-2 flex-wrap">
                <div className="flex rounded-full bg-gray-100 dark:bg-gray-800 p-0.5 text-[11px] sm:text-xs">
                  {(["day", "week", "month"] as ViewMode[]).map((v) => (
                    <button
                      key={v}
                      onClick={() => setView(v)}
                      className={`px-2.5 sm:px-3 py-1.5 rounded-full font-medium transition-colors ${
                        view === v
                          ? "bg-white dark:bg-gray-700 shadow-sm"
                          : "text-gray-500 hover:text-gray-800 dark:hover:text-gray-200"
                      }`}
                    >
                      {VIEW_LABELS[v]}
                    </button>
                  ))}
                </div>

                {selectMode ? (
                  <>
                    <button
                      onClick={deleteSelected}
                      disabled={selectedVisibleIds.length === 0 || deleting}
                      className="rounded-full bg-red-600 text-white px-4 py-1.5 text-sm font-medium disabled:opacity-50"
                    >
                      {deleting ? "Deleting…" : `Delete (${selectedVisibleIds.length})`}
                    </button>
                    <button
                      onClick={toggleSelectMode}
                      className="rounded-full border border-gray-200 dark:border-gray-700 px-4 py-1.5 text-sm font-medium hover:bg-gray-50 dark:hover:bg-gray-800"
                    >
                      Cancel
                    </button>
                  </>
                ) : (
                  // Kept on one line together: wrapping is fine for the pill,
                  // but a "···" alone on its own row reads as a stray glyph.
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      onClick={() => setModal({ mode: "create", date: defaultNewEventDate() })}
                      className="rounded-full bg-teal-700 text-white hover:bg-teal-800 px-3 sm:px-4 py-1.5 text-sm font-medium whitespace-nowrap"
                    >
                      <span className="sm:hidden">+ New</span>
                      <span className="hidden sm:inline">+ Create event</span>
                    </button>
                    <div className="relative" ref={menuRef}>
                      <button onClick={() => setMenuOpen((v) => !v)} className={iconButton} aria-label="More actions">
                        ···
                      </button>
                      {menuOpen && (
                        <div className="absolute right-0 mt-2 w-56 rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 shadow-lg z-30 overflow-hidden">
                          <button
                            onClick={() => (setMenuOpen(false), toggleSelectMode())}
                            className={menuItem}
                          >
                            Select events
                          </button>
                          <button
                            onClick={() => (setMenuOpen(false), setShowImportModal(true))}
                            className={menuItem}
                          >
                            Import screenshot
                          </button>
                          <button
                            onClick={() => (setMenuOpen(false), deleteAllNative())}
                            disabled={deleting}
                            className={`${menuItem} text-red-600 dark:text-red-400 disabled:opacity-50`}
                            title='Delete every "This app" (native) event, across all dates'
                          >
                            Clear all my events
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>

            {selectMode && (
              <p className="text-xs text-gray-500 mb-3">Tap events to select them, then Delete. Tap Cancel to stop.</p>
            )}

            {loading && events.length === 0 ? (
              <p className="text-sm text-gray-500 py-8 text-center">Loading…</p>
            ) : filters.length === 0 ? (
              <p className="text-sm text-gray-500 py-8 text-center">
                Everything is hidden. Tick something under Show to see your calendar.
              </p>
            ) : view === "month" ? (
              <MonthGrid
                year={cursor.getFullYear()}
                month={cursor.getMonth()}
                events={visibleEvents}
                onDayClick={handleDayClick}
                onEventClick={handleEventClick}
                onEventReschedule={selectMode ? undefined : handleEventReschedule}
                selectedIds={selectMode ? selectedIds : undefined}
              />
            ) : (
              <TimeGridView
                days={weekDays ?? [cursor]}
                events={visibleEvents}
                onSlotClick={(date) => !selectMode && setModal({ mode: "create", date })}
                onEventClick={handleEventClick}
                onEventReschedule={selectMode ? undefined : handleEventReschedule}
                selectedIds={selectMode ? selectedIds : undefined}
              />
            )}
          </div>
        </main>
      </div>

      {sidebarOpen && (
        <div className="lg:hidden fixed inset-0 z-40 flex">
          <button
            className="absolute inset-0 bg-black/40"
            onClick={() => setSidebarOpen(false)}
            aria-label="Close panel"
          />
          <div className="relative w-[85%] max-w-xs h-full overflow-y-auto bg-gray-50 dark:bg-gray-950 p-4 shadow-xl">
            <button
              onClick={() => setSidebarOpen(false)}
              className="mb-3 text-sm text-gray-500 hover:underline"
            >
              ← Close
            </button>
            {sidebar}
          </div>
        </div>
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
