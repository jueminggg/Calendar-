"use client";

import { useEffect, useMemo, useRef } from "react";
import type { CalendarEvent } from "./types";
import { SOURCE_COLORS } from "@/lib/event-colors";

const HOUR_HEIGHT = 48; // px

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

export default function TimeGridView({
  days,
  events,
  onSlotClick,
  onEventClick,
}: {
  days: Date[];
  events: CalendarEvent[];
  onSlotClick: (date: Date) => void;
  onEventClick: (event: CalendarEvent) => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const today = new Date();
  const hours = Array.from({ length: 24 }, (_, i) => i);

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

  return (
    <div className="border border-gray-200 dark:border-gray-800 rounded-lg overflow-hidden">
      <div className="grid" style={{ gridTemplateColumns: gridCols }}>
        <div className="border-b border-r border-gray-200 dark:border-gray-800" />
        {days.map((day) => (
          <div
            key={day.toISOString()}
            className="text-center text-xs font-medium px-2 py-2 border-b border-r border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-900/40"
          >
            <div className="text-gray-500">{day.toLocaleDateString(undefined, { weekday: "short" })}</div>
            <div
              className={`inline-flex items-center justify-center w-6 h-6 rounded-full mt-0.5 ${
                isSameDay(day, today) ? "bg-black text-white dark:bg-white dark:text-black" : ""
              }`}
            >
              {day.getDate()}
            </div>
          </div>
        ))}

        <div className="border-r border-gray-200 dark:border-gray-800 text-[11px] text-gray-400 px-1 py-1">All day</div>
        {days.map((day, i) => (
          <div
            key={day.toISOString()}
            className="border-r border-b border-gray-200 dark:border-gray-800 p-1 space-y-0.5 min-h-[28px]"
          >
            {eventsByDay[i]
              .filter((e) => e.allDay)
              .map((e) => (
                <button
                  key={e.id}
                  onClick={() => onEventClick(e)}
                  className="w-full text-left text-[11px] leading-tight truncate rounded px-1 py-0.5 text-white"
                  style={{ backgroundColor: e.calendarColor ?? SOURCE_COLORS[e.source] }}
                  title={e.title}
                >
                  {e.title}
                </button>
              ))}
          </div>
        ))}
      </div>

      <div ref={scrollRef} className="overflow-y-auto max-h-[65vh]">
        <div className="grid" style={{ gridTemplateColumns: gridCols }}>
          <div>
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

          {days.map((day, i) => {
            const placed = layoutDay(
              day,
              eventsByDay[i].filter((e) => !e.allDay),
            );
            return (
              <div key={day.toISOString()} className="relative border-r border-gray-200 dark:border-gray-800">
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
                {placed.map((p) => (
                  <button
                    key={p.event.id}
                    onClick={(e) => {
                      e.stopPropagation();
                      onEventClick(p.event);
                    }}
                    className="absolute rounded px-1 py-0.5 text-[11px] leading-tight text-white overflow-hidden text-left"
                    style={{
                      top: p.top,
                      height: Math.max(p.height, 18),
                      left: `${(p.col / p.totalCols) * 100}%`,
                      width: `${100 / p.totalCols}%`,
                      backgroundColor: p.event.calendarColor ?? SOURCE_COLORS[p.event.source],
                    }}
                    title={p.event.title}
                  >
                    {p.event.title}
                  </button>
                ))}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
