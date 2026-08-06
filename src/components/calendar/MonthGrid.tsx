"use client";

import { useState } from "react";
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

type DragState = { eventId: string; pointerId: number; startClientX: number; startClientY: number; overDayIndex: number | null };

export default function MonthGrid({
  year,
  month,
  events,
  onDayClick,
  onEventClick,
  onEventReschedule,
  selectedIds,
}: {
  year: number;
  month: number;
  events: CalendarEvent[];
  onDayClick: (date: Date) => void;
  onEventClick: (event: CalendarEvent) => void;
  /** Drag-to-move (onto a different day, same time-of-day) is enabled when provided. */
  onEventReschedule?: (event: CalendarEvent, newStart: Date, newEnd: Date) => void;
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
  const [dragState, setDragState] = useState<DragState | null>(null);

  function dayIndexAtPoint(clientX: number, clientY: number): number | null {
    const el = document.elementFromPoint(clientX, clientY)?.closest<HTMLElement>("[data-day-index]");
    if (!el) return null;
    const idx = Number(el.dataset.dayIndex);
    return Number.isNaN(idx) ? null : idx;
  }

  function handlePointerDown(e: React.PointerEvent<HTMLButtonElement>, eventId: string) {
    if (!onEventReschedule) return;
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    setDragState({ eventId, pointerId: e.pointerId, startClientX: e.clientX, startClientY: e.clientY, overDayIndex: null });
  }

  function handlePointerMove(e: React.PointerEvent<HTMLButtonElement>) {
    if (!dragState || e.pointerId !== dragState.pointerId) return;
    const overDayIndex = dayIndexAtPoint(e.clientX, e.clientY);
    setDragState((prev) => (prev ? { ...prev, overDayIndex } : prev));
  }

  function handlePointerUp(e: React.PointerEvent<HTMLButtonElement>, event: CalendarEvent) {
    if (!dragState || e.pointerId !== dragState.pointerId) return;
    const moved = Math.hypot(e.clientX - dragState.startClientX, e.clientY - dragState.startClientY);
    const overDayIndex = dragState.overDayIndex;
    setDragState(null);
    if (moved < 6 || overDayIndex === null) {
      onEventClick(event);
      return;
    }
    const targetDay = days[overDayIndex];
    if (!targetDay) return;
    const oldStart = new Date(event.startAt);
    const durationMs = new Date(event.endAt).getTime() - oldStart.getTime();
    const newStart = new Date(targetDay);
    newStart.setHours(oldStart.getHours(), oldStart.getMinutes(), oldStart.getSeconds(), 0);
    const newEnd = new Date(newStart.getTime() + durationMs);
    onEventReschedule?.(event, newStart, newEnd);
  }

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
      {days.map((day, dayIndex) => {
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
        const isDropTarget = dragState !== null && dragState.overDayIndex === dayIndex;

        return (
          <div
            key={day.toISOString()}
            data-day-index={dayIndex}
            onClick={() => onDayClick(day)}
            className={`min-h-[100px] border-b border-r border-gray-200 dark:border-gray-800 p-1.5 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-900/40 ${
              inMonth ? "" : "bg-gray-50/50 dark:bg-black/20"
            } ${isDropTarget ? "ring-2 ring-inset ring-pink-500 bg-pink-50 dark:bg-pink-950/40" : ""}`}
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
                      if (!onEventReschedule) onEventClick(event);
                    }}
                    onPointerDown={(e) => handlePointerDown(e, event.id)}
                    onPointerMove={handlePointerMove}
                    onPointerUp={(e) => handlePointerUp(e, event)}
                    className={`w-full text-left text-[11px] leading-tight truncate rounded px-1 py-0.5 text-white ${
                      selectedIds ? (selected ? "ring-2 ring-pink-500" : "opacity-40") : ""
                    } ${onEventReschedule ? "cursor-grab active:cursor-grabbing" : ""}`}
                    style={{ backgroundColor: event.calendarColor ?? SOURCE_COLORS[event.source], touchAction: onEventReschedule ? "none" : undefined }}
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
