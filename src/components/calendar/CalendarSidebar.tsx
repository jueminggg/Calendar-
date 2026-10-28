"use client";

import Link from "next/link";
import { useMemo } from "react";
import { FILTER_ROWS, type FilterKey } from "@/lib/event-filters";

function startOfDay(d: Date): Date {
  const r = new Date(d);
  r.setHours(0, 0, 0, 0);
  return r;
}
function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

const WEEKDAY_INITIALS = ["S", "M", "T", "W", "T", "F", "S"];

/**
 * The six-row grid behind the mini month. Always six rows so the panel below
 * it doesn't jump as you page between months of different shapes.
 */
function monthGridDays(year: number, month: number): Date[] {
  const first = new Date(year, month, 1);
  const gridStart = new Date(first);
  gridStart.setDate(first.getDate() - first.getDay());
  return Array.from({ length: 42 }, (_, i) => {
    const d = new Date(gridStart);
    d.setDate(gridStart.getDate() + i);
    return d;
  });
}

export default function CalendarSidebar({
  cursor,
  onPickDate,
  filters,
  onToggleFilter,
  counts,
}: {
  cursor: Date;
  onPickDate: (date: Date) => void;
  filters: FilterKey[];
  onToggleFilter: (key: FilterKey) => void;
  /** How many entries of each kind are in the range on screen, so a row that
   *  would hide nothing says so rather than looking broken when ticked. */
  counts: Record<FilterKey, number>;
}) {
  const today = useMemo(() => startOfDay(new Date()), []);
  const days = useMemo(() => monthGridDays(cursor.getFullYear(), cursor.getMonth()), [cursor]);

  return (
    <div className="space-y-4">
      <section className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4">
        <h2 className="text-sm font-semibold mb-3">
          {cursor.toLocaleDateString(undefined, { month: "long", year: "numeric" })}
        </h2>
        <div className="grid grid-cols-7 gap-y-1 text-center">
          {WEEKDAY_INITIALS.map((d, i) => (
            <div key={i} className="text-[10px] font-medium text-gray-400 pb-1">
              {d}
            </div>
          ))}
          {days.map((day) => {
            const inMonth = day.getMonth() === cursor.getMonth();
            const isToday = isSameDay(day, today);
            const isCursor = isSameDay(day, cursor);
            return (
              <button
                key={day.toISOString()}
                onClick={() => onPickDate(startOfDay(day))}
                className={`h-7 w-7 mx-auto rounded-full text-[11px] leading-none flex items-center justify-center transition-colors ${
                  isCursor
                    ? "bg-teal-700 text-white font-semibold"
                    : isToday
                      ? "ring-1 ring-teal-500 text-teal-700 dark:text-teal-400 font-semibold"
                      : inMonth
                        ? "hover:bg-gray-100 dark:hover:bg-gray-800"
                        : "text-gray-300 dark:text-gray-600 hover:bg-gray-100 dark:hover:bg-gray-800"
                }`}
                aria-label={day.toDateString()}
                aria-current={isToday ? "date" : undefined}
              >
                {day.getDate()}
              </button>
            );
          })}
        </div>
      </section>

      <section className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4">
        <h2 className="text-sm font-semibold mb-3">Show</h2>
        <ul className="space-y-1">
          {FILTER_ROWS.map((row) => {
            const checked = filters.includes(row.key);
            const count = counts[row.key] ?? 0;
            return (
              <li key={row.key}>
                <label className="flex items-center gap-2.5 py-1.5 px-1 rounded-lg cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800/60">
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => onToggleFilter(row.key)}
                    className="h-4 w-4 accent-teal-700 shrink-0"
                  />
                  <span
                    className="h-2.5 w-2.5 rounded-full shrink-0"
                    style={{ backgroundColor: row.color }}
                    aria-hidden
                  />
                  <span className={`text-sm flex-1 min-w-0 truncate ${checked ? "" : "text-gray-400"}`}>
                    {row.label}
                  </span>
                  <span className="text-[11px] tabular-nums text-gray-400 shrink-0">{count}</span>
                </label>
              </li>
            );
          })}
        </ul>
        {filters.length === 0 && (
          <p className="text-[11px] text-gray-500 mt-2">Nothing is shown. Tick something to see your calendar.</p>
        )}
      </section>

      <section className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4">
        <h2 className="text-sm font-semibold mb-2">Other calendars</h2>
        <p className="text-xs text-gray-500 mb-3">Connect Google, iCloud or Outlook to see them here.</p>
        <Link
          href="/settings/connections"
          className="inline-block text-sm font-medium text-teal-700 dark:text-teal-400 hover:underline"
        >
          Manage connections
        </Link>
      </section>
    </div>
  );
}
