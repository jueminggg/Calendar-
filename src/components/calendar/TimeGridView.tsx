"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { CalendarEvent } from "./types";
import { SOURCE_COLORS } from "@/lib/event-colors";

const HOUR_HEIGHT = 48; // px
const HEADER_HEIGHT = 56; // px, the sticky day-of-week/date row

function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function minutesSinceMidnight(d: Date): number {
  return d.getHours() * 60 + d.getMinutes();
}

type Placed = { event: CalendarEvent; col: number; totalCols: number; top: number; height: number };

/** Lays timed events out into side-by-side columns for a single day, clamping
 *  multi-day events to this day's midnight-to-midnight window. */
function layoutDay(day: Date, dayEvents: CalendarEvent[]): Placed[] {
  const timed = dayEvents
    .map((e) => {
      const start = new Date(e.startAt);
      const end = new Date(e.endAt);
      const startMin = isSameDay(start, day) ? minutesSinceMidnight(start) : 0;
      const endMin = isSameDay(end, day) ? minutesSinceMidnight(end) : 24 * 60;
      return { event: e, startMin, endMin: Math.max(endMin, startMin + 20) };
    })
    .sort((a, b) => a.startMin - b.startMin);

  const columns: { end: number }[] = [];
  const withCols = timed.map((t) => {
    let col = columns.findIndex((c) => c.end <= t.startMin);
    if (col === -1) {
      col = columns.length;
      columns.push({ end: t.endMin });
    } else {
      columns[col].end = t.endMin;
    }
    return { ...t, col };
  });
  const totalCols = columns.length || 1;

  return withCols.map((t) => ({
    event: t.event,
    col: t.col,
    totalCols,
    top: (t.startMin / 60) * HOUR_HEIGHT,
    height: ((t.endMin - t.startMin) / 60) * HOUR_HEIGHT,
  }));
}

type DragState = {
  eventId: string;
  dayIndex: number;
  pointerId: number;
  startClientY: number;
  originTop: number;
  liveTop: number;
  height: number;
  durationMs: number;
};

export default function TimeGridView({
  days,
  events,
  onSlotClick,
  onEventClick,
  onEventReschedule,
  selectedIds,
}: {
  days: Date[];
  events: CalendarEvent[];
  onSlotClick: (date: Date) => void;
  onEventClick: (event: CalendarEvent) => void;
  /** Drag-to-reschedule (vertical, within the same day) is enabled when provided. */
  onEventReschedule?: (event: CalendarEvent, newStart: Date, newEnd: Date) => void;
  /** When set (select mode is active), events in this set render checked and others dim. */
  selectedIds?: Set<string>;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const today = new Date();
  const hours = Array.from({ length: 24 }, (_, i) => i);
  const [dragState, setDragState] = useState<DragState | null>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 7 * HOUR_HEIGHT });
  }, []);

  const eventsByDay = useMemo(
    () =>
      days.map((day) =>
        events.filter((e) => {
          const s = new Date(e.startAt);
          const en = new Date(e.endAt);
          return (
            day >= new Date(s.getFullYear(), s.getMonth(), s.getDate()) &&
            day <= new Date(en.getFullYear(), en.getMonth(), en.getDate())
          );
        }),
      ),
    [days, events],
  );

  const gridCols = `56px repeat(${days.length}, 1fr)`;

  function handlePointerDown(e: React.PointerEvent<HTMLButtonElement>, p: Placed, dayIndex: number) {
    if (!onEventReschedule) return;
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    setDragState({
      eventId: p.event.id,
      dayIndex,
      pointerId: e.pointerId,
      startClientY: e.clientY,
      originTop: p.top,
      liveTop: p.top,
      height: p.height,
      durationMs: new Date(p.event.endAt).getTime() - new Date(p.event.startAt).getTime(),
    });
  }

  function handlePointerMove(e: React.PointerEvent<HTMLButtonElement>) {
    if (!dragState || e.pointerId !== dragState.pointerId) return;
    const deltaY = e.clientY - dragState.startClientY;
    const maxTop = 24 * HOUR_HEIGHT - dragState.height;
    const newTop = Math.min(Math.max(dragState.originTop + deltaY, 0), maxTop);
    setDragState((prev) => (prev ? { ...prev, liveTop: newTop } : prev));
  }

  function handlePointerUp(e: React.PointerEvent<HTMLButtonElement>, p: Placed, dayIndex: number) {
    if (!dragState || e.pointerId !== dragState.pointerId) return;
    const moved = Math.abs(dragState.liveTop - dragState.originTop);
    setDragState(null);
    if (moved < 4) {
      onEventClick(p.event);
      return;
    }
    const minutesFromMidnight = Math.round((dragState.liveTop / HOUR_HEIGHT) * 60 / 15) * 15;
    const dayStart = new Date(days[dayIndex]);
    dayStart.setHours(0, 0, 0, 0);
    const newStart = new Date(dayStart.getTime() + minutesFromMidnight * 60000);
    const newEnd = new Date(newStart.getTime() + dragState.durationMs);
    onEventReschedule?.(p.event, newStart, newEnd);
  }

  return (
    <div className="border border-gray-200 dark:border-gray-800 rounded-lg overflow-hidden">
      <div ref={scrollRef} className="overflow-y-auto max-h-[75vh]">
        <div className="grid" style={{ gridTemplateColumns: gridCols }}>
          <div
            className="min-w-0 sticky top-0 z-20 border-b border-r border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-900/40"
            style={{ height: HEADER_HEIGHT }}
          />
          {days.map((day) => (
            <div
              key={`h-${day.toISOString()}`}
              className="min-w-0 sticky top-0 z-20 text-center text-xs font-medium px-2 py-2 border-b border-r border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-900/40"
              style={{ height: HEADER_HEIGHT }}
            >
              <div className="text-gray-500">{day.toLocaleDateString(undefined, { weekday: "short" })}</div>
              <div
                className={`inline-flex items-center justify-center w-6 h-6 rounded-full mt-0.5 ${
                  isSameDay(day, today) ? "bg-pink-600 text-white" : ""
                }`}
              >
                {day.getDate()}
              </div>
            </div>
          ))}

          <div
            className="min-w-0 sticky z-20 border-r border-b border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-950 text-[11px] text-gray-400 px-1 py-1"
            style={{ top: HEADER_HEIGHT }}
          >
            All day
          </div>
          {days.map((day, i) => (
            <div
              key={`ad-${day.toISOString()}`}
              className="min-w-0 sticky z-20 border-r border-b border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-950 p-1 space-y-0.5 min-h-[28px]"
              style={{ top: HEADER_HEIGHT }}
            >
              {eventsByDay[i]
                .filter((e) => e.allDay)
                .map((e) => {
                  const selected = selectedIds?.has(e.id);
                  return (
                    <button
                      key={e.id}
                      onClick={() => onEventClick(e)}
                      className={`w-full text-left text-[11px] leading-tight truncate rounded px-1 py-0.5 text-white ${
                        selectedIds ? (selected ? "ring-2 ring-pink-500" : "opacity-40") : ""
                      }`}
                      style={{ backgroundColor: e.calendarColor ?? SOURCE_COLORS[e.source] }}
                      title={e.title}
                    >
                      {selected ? "✓ " : ""}
                      {e.title}
                    </button>
                  );
                })}
            </div>
          ))}

          <div className="min-w-0">
            {hours.map((h) => (
              <div
                key={h}
                style={{ height: HOUR_HEIGHT }}
                className="border-r border-b border-gray-200 dark:border-gray-800 text-[10px] text-gray-400 text-right pr-1"
              >
                {h === 0 ? "" : new Date(2000, 0, 1, h).toLocaleTimeString([], { hour: "numeric" })}
              </div>
            ))}
          </div>

          {days.map((day, dayIndex) => {
            const placed = layoutDay(
              day,
              eventsByDay[dayIndex].filter((e) => !e.allDay),
            );
            return (
              <div key={day.toISOString()} className="min-w-0 relative border-r border-gray-200 dark:border-gray-800">
                {hours.map((h) => (
                  <div
                    key={h}
                    style={{ height: HOUR_HEIGHT }}
                    className="border-b border-gray-200 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-900/40 cursor-pointer"
                    onClick={() => {
                      const d = new Date(day);
                      d.setHours(h, 0, 0, 0);
                      onSlotClick(d);
                    }}
                  />
                ))}
                {placed.map((p) => {
                  const selected = selectedIds?.has(p.event.id);
                  const isDragging = dragState?.eventId === p.event.id && dragState.dayIndex === dayIndex;
                  const top = isDragging ? dragState.liveTop : p.top;
                  return (
                    <button
                      key={p.event.id}
                      onClick={(e) => {
                        e.stopPropagation();
                        if (!onEventReschedule) onEventClick(p.event);
                      }}
                      onPointerDown={(e) => handlePointerDown(e, p, dayIndex)}
                      onPointerMove={handlePointerMove}
                      onPointerUp={(e) => handlePointerUp(e, p, dayIndex)}
                      className={`absolute rounded px-1 py-0.5 text-[11px] leading-tight text-white overflow-hidden text-left ${
                        selectedIds ? (selected ? "ring-2 ring-pink-500" : "opacity-40") : ""
                      } ${isDragging ? "shadow-lg z-30 opacity-90" : ""} ${onEventReschedule ? "cursor-grab active:cursor-grabbing" : ""}`}
                      style={{
                        top,
                        height: Math.max(p.height, 18),
                        left: isDragging ? 0 : `${(p.col / p.totalCols) * 100}%`,
                        width: isDragging ? "100%" : `${100 / p.totalCols}%`,
                        backgroundColor: p.event.calendarColor ?? SOURCE_COLORS[p.event.source],
                        touchAction: onEventReschedule ? "none" : undefined,
                      }}
                      title={p.event.title}
                    >
                      {selected ? "✓ " : ""}
                      {p.event.title}
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
