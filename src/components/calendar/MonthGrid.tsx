"use client";

import type { CalendarEvent } from "./types";
import { SOURCE_COLORS } from "@/lib/event-colors";

function startOfMonthGrid(year: number, month: number): Date {
  const first = new Date(year, month, 1);
  const day = first.getDay(); // 0 = Sunday
  const gridStart = new Date(first);
  gridStart.setDate(first.getDate() - day);
  return gridStart;
}

function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

export default function MonthGrid({
  year,
  month,
  events,
  onDayClick,
  onEventClick,
  selectedIds,
}: {
  year: number;
  month: number;
  events: CalendarEvent[];
  onDayClick: (date: Date) => void;
  onEventClick: (event: CalendarEvent) => void;
  /** When set (select mode is active), events in this set render checked and others dim. */
  selectedIds?: Set<string>;
}) {
  const gridStart = startOfMonthGrid(year, month);
  const days: Date[] = Array.from({ length: 42 }, (_, i) => {
    const d = new Date(gridStart);
    d.setDate(gridStart.getDate() + i);
    return d;
  });
  const today = new Date();

  return (
    <div className="grid grid-cols-7 border-t border-l border-gray-200 dark:border-gray-800">
      {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
        <div
          key={d}
          className="text-xs font-medium text-gray-500 px-2 py-1 border-b border-r border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-900/40"
        >
          {d}
        </div>
      ))}
      {days.map((day) => {
        const inMonth = day.getMonth() === month;
        const dayEvents = events
          .filter((e) => {
            const s = new Date(e.startAt);
            const en = new Date(e.endAt);
            return day >= new Date(s.getFullYear(), s.getMonth(), s.getDate()) &&
              day <= new Date(en.getFullYear(), en.getMonth(), en.getDate());
          })
          .sort((a, b) => new Date(a.startAt).getTime() - new Date(b.startAt).getTime());

        const visible = dayEvents.slice(0, 3);
        const overflow = dayEvents.length - visible.length;

        return (
          <div
            key={day.toISOString()}
            onClick={() => onDayClick(day)}
            className={`min-h-[100px] border-b border-r border-gray-200 dark:border-gray-800 p-1.5 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-900/40 ${
              inMonth ? "" : "bg-gray-50/50 dark:bg-black/20"
            }`}
          >
            <span
              className={`text-xs inline-flex items-center justify-center w-5 h-5 rounded-full ${
                isSameDay(day, today) ? "bg-pink-600 text-white hover:bg-pink-700 dark:bg-pink-600 dark:hover:bg-pink-700" : "text-gray-500"
              } ${inMonth ? "" : "opacity-40"}`}
            >
              {day.getDate()}
            </span>
            <div className="mt-1 space-y-0.5">
              {visible.map((event) => {
                const selected = selectedIds?.has(event.id);
                return (
                  <button
                    key={event.id}
                    onClick={(e) => {
                      e.stopPropagation();
                      onEventClick(event);
                    }}
                    className={`w-full text-left text-[11px] leading-tight truncate rounded px-1 py-0.5 text-white ${
                      selectedIds ? (selected ? "ring-2 ring-pink-500" : "opacity-40") : ""
                    }`}
                    style={{ backgroundColor: event.calendarColor ?? SOURCE_COLORS[event.source] }}
                    title={event.title}
                  >
                    {selected ? "✓ " : ""}
                    {event.allDay ? "" : `${new Date(event.startAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })} `}
                    {event.title}
                  </button>
                );
              })}
              {overflow > 0 && <div className="text-[11px] text-gray-500 px-1">+{overflow} more</div>}
            </div>
          </div>
        );
      })}
    </div>
  );
}
