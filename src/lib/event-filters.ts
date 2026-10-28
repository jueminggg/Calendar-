import { SOURCE_COLORS } from "@/lib/event-colors";

/**
 * What the calendar can be filtered down to. These are not quite Event.source:
 * a to-do is drawn in the native colour but is its own kind of thing, and
 * hiding your events shouldn't take the day's to-dos with it.
 */
export type FilterKey = "NATIVE" | "TODO" | "GOOGLE" | "APPLE" | "MICROSOFT";

export const FILTER_ROWS: { key: FilterKey; label: string; color: string }[] = [
  { key: "NATIVE", label: "My events", color: SOURCE_COLORS.NATIVE },
  { key: "TODO", label: "To-dos", color: SOURCE_COLORS.NATIVE },
  { key: "GOOGLE", label: "Google", color: SOURCE_COLORS.GOOGLE },
  { key: "APPLE", label: "iCloud", color: SOURCE_COLORS.APPLE },
  { key: "MICROSOFT", label: "Outlook", color: SOURCE_COLORS.MICROSOFT },
];

export const ALL_FILTER_KEYS: FilterKey[] = FILTER_ROWS.map((r) => r.key);

/** Which row an entry belongs to. Checked before source, since a to-do is a
 *  NATIVE entry that gets its own switch. */
export function eventFilterKey(event: { source: string; kind?: string; importedVia?: string | null }): FilterKey {
  if (event.kind === "task" || event.importedVia === "todo") return "TODO";
  if (event.source === "GOOGLE" || event.source === "APPLE" || event.source === "MICROSOFT") return event.source;
  return "NATIVE";
}

const STORAGE_KEY = "calendar.filters.v1";

/**
 * Reads the saved selection, falling back to everything visible. A stored
 * value is intersected with the keys that exist today rather than trusted, so
 * a renamed or dropped source can't leave a filter nothing can switch back on.
 * Never throws: storage is unavailable in private windows and the calendar
 * must still render.
 */
function readStored(): FilterKey[] {
  if (typeof window === "undefined") return ALL_FILTER_KEYS;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return ALL_FILTER_KEYS;
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return ALL_FILTER_KEYS;
    const kept = ALL_FILTER_KEYS.filter((k) => parsed.includes(k));
    // An empty result means a stale or corrupt entry, not a deliberate "hide
    // everything" -- that is reachable in the UI but would look like a broken
    // calendar on load, with no hint of why.
    return kept.length > 0 ? kept : ALL_FILTER_KEYS;
  } catch {
    return ALL_FILTER_KEYS;
  }
}

/**
 * The selection lives outside React, in a store read through
 * useSyncExternalStore, rather than in state seeded by an effect.
 *
 * Two reasons. Reading localStorage during render would disagree with the
 * server-rendered markup and break hydration, since the server has no storage
 * to read; useSyncExternalStore is built for exactly that, serving the server
 * snapshot through hydration and switching to the real one straight after. And
 * seeding state from an effect instead would be a setState in an effect body,
 * which cascades renders -- a rule this codebase already enforces.
 */
let current: FilterKey[] | null = null;
const listeners = new Set<() => void>();

/** Must stay referentially stable between writes: useSyncExternalStore
 *  re-renders in a loop if the snapshot is a fresh array each call. */
export function getFiltersSnapshot(): FilterKey[] {
  if (current === null) current = readStored();
  return current;
}

export function getFiltersServerSnapshot(): FilterKey[] {
  return ALL_FILTER_KEYS;
}

export function subscribeFilters(onChange: () => void): () => void {
  listeners.add(onChange);
  return () => {
    listeners.delete(onChange);
  };
}

export function setStoredFilters(keys: FilterKey[]): void {
  current = keys;
  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(keys));
    } catch {
      // A filter that doesn't survive a reload is a far smaller problem than a
      // calendar that throws while you tick a box.
    }
  }
  for (const listener of listeners) listener();
}
