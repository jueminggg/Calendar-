// Pure, synchronous scheduling logic for "Plan my day" — kept free of I/O
// (DB, HTTP) so it's easy to reason about and test; src/lib/runPlanDay.ts
// wires this together with Prisma and the Distance Matrix lookup in
// travelTime.ts.

export const DEFAULT_TASK_MINUTES = 30;
export const DEFAULT_DAY_START_HOUR = 7;
export const DEFAULT_DAY_END_HOUR = 22;

// Location tags (case-insensitive) that mean "this task can only be done
// while actually traveling" — they're matched against the travel-time
// buffers carved out between differently-located events, not against a
// fixed place.
const TRAVEL_LOCATION_ALIASES = new Set(["traveling", "travelling", "travel", "commute", "commuting", "on the go", "in transit"]);

export function isTravelTag(location: string | null): boolean {
  return location !== null && TRAVEL_LOCATION_ALIASES.has(location.trim().toLowerCase());
}

export type FixedBlock = { startAt: Date; endAt: Date; location: string | null };
export type FreeWindow = { startAt: Date; endAt: Date };
export type RawWindow = FreeWindow & { beforeLocation: string | null; afterLocation: string | null };
/** A free window tagged with the place it's associated with — a real
 * location (you're still near where the last event was), "Traveling" (this
 * slice is a travel-time buffer), or null (no particular place). */
export type LocatedWindow = FreeWindow & { locationTag: string | null };
export type PlanPriority = "LOW" | "MED" | "HIGH";
export type PlanTask = { id: string; estimatedMinutes: number | null; deadline: Date | null; priority: PlanPriority; location: string | null };
export type Placement = { taskId: string; startAt: Date; endAt: Date };

const PRIORITY_RANK: Record<PlanPriority, number> = { HIGH: 0, MED: 1, LOW: 2 };

/**
 * Gaps between fixed blocks (calendar events) within [dayStart, dayEnd],
 * each carrying the location of the block immediately before/after it (null
 * at the very start/end of the day, or if that neighbor has no location) so
 * a travel-time buffer can be applied to the right gaps afterward.
 */
export function computeRawWindows(dayStart: Date, dayEnd: Date, blocks: FixedBlock[]): RawWindow[] {
  const clipped = blocks
    .map((b) => ({
      startAt: new Date(Math.max(b.startAt.getTime(), dayStart.getTime())),
      endAt: new Date(Math.min(b.endAt.getTime(), dayEnd.getTime())),
      location: b.location,
    }))
    .filter((b) => b.endAt.getTime() > b.startAt.getTime())
    .sort((a, b) => a.startAt.getTime() - b.startAt.getTime());

  // Merge overlapping/back-to-back blocks so a "gap" is never invented
  // inside a double-booked stretch of the day.
  const merged: typeof clipped = [];
  for (const b of clipped) {
    const last = merged[merged.length - 1];
    if (last && b.startAt.getTime() <= last.endAt.getTime()) {
      if (b.endAt.getTime() > last.endAt.getTime()) {
        last.endAt = b.endAt;
        last.location = b.location; // the later block's location applies going forward
      }
    } else {
      merged.push({ ...b });
    }
  }

  const windows: RawWindow[] = [];
  let cursor = dayStart;
  let beforeLocation: string | null = null;

  for (const block of merged) {
    if (block.startAt.getTime() > cursor.getTime()) {
      windows.push({ startAt: cursor, endAt: block.startAt, beforeLocation, afterLocation: block.location });
    }
    cursor = block.endAt;
    beforeLocation = block.location;
  }
  if (dayEnd.getTime() > cursor.getTime()) {
    windows.push({ startAt: cursor, endAt: dayEnd, beforeLocation, afterLocation: null });
  }

  return windows;
}

/**
 * Splits a raw window into up to two located windows: the bulk of it
 * (tagged with whichever location you're still near — the "before" one, if
 * any), plus — when the block before and after have different non-empty
 * locations — a "Traveling" window reserved at the end, sized to the travel
 * buffer, so travel-appropriate tasks can actually use that time instead of
 * it just being dead space. With no buffer needed, returns the window as-is
 * with whichever single location applies (if any).
 */
export function splitForTravel(window: RawWindow, travelBufferMinutes: number): LocatedWindow[] {
  const before = window.beforeLocation?.trim() || null;
  const after = window.afterLocation?.trim() || null;
  const sameLocation = before && after && before.toLowerCase() === after.toLowerCase();
  const needsTravel = before && after && !sameLocation && travelBufferMinutes > 0;

  if (!needsTravel) {
    return [{ startAt: window.startAt, endAt: window.endAt, locationTag: sameLocation ? before : (before ?? after) }];
  }

  const travelStart = new Date(Math.max(window.endAt.getTime() - travelBufferMinutes * 60_000, window.startAt.getTime()));
  const result: LocatedWindow[] = [];
  if (travelStart.getTime() > window.startAt.getTime()) {
    result.push({ startAt: window.startAt, endAt: travelStart, locationTag: before });
  }
  result.push({ startAt: travelStart, endAt: window.endAt, locationTag: "Traveling" });
  return result;
}

/** Whether a task with this location tag is allowed (not just preferred) to run in a window with this tag. */
function locationFits(taskLocation: string | null, windowTag: string | null): boolean {
  const windowIsTravel = isTravelTag(windowTag);
  if (isTravelTag(taskLocation)) return windowIsTravel; // travel-tagged tasks ONLY fit travel windows
  if (windowIsTravel) return taskLocation === null; // travel windows take travel-tagged or untagged tasks, not place-tagged ones
  return true; // regular windows accept anything; place-matching is a soft preference below, not a requirement
}

function locationMatches(taskLocation: string | null, windowTag: string | null): boolean {
  if (!taskLocation || !windowTag) return false;
  return taskLocation.trim().toLowerCase() === windowTag.trim().toLowerCase();
}

/**
 * Index of the best eligible candidate for a window with this much time
 * left — ranked by (1) earliest deadline (nulls last), (2) higher priority,
 * (3) whether its location tag matches the window's, (4) the duration that
 * best fills the remaining space. Returns -1 if nothing in the list both
 * fits the remaining time and is location-eligible for this window.
 */
function pickBestCandidateIndex<T extends PlanTask>(candidates: T[], remainingMinutes: number, windowTag: string | null): number {
  let bestIndex = -1;
  for (let i = 0; i < candidates.length; i++) {
    const candidate = candidates[i];
    const duration = candidate.estimatedMinutes ?? DEFAULT_TASK_MINUTES;
    if (duration > remainingMinutes) continue;
    if (!locationFits(candidate.location, windowTag)) continue;

    if (bestIndex === -1) {
      bestIndex = i;
      continue;
    }
    const best = candidates[bestIndex];
    const bestDuration = best.estimatedMinutes ?? DEFAULT_TASK_MINUTES;
    const candidateDeadline = candidate.deadline ? candidate.deadline.getTime() : Infinity;
    const bestDeadline = best.deadline ? best.deadline.getTime() : Infinity;
    if (candidateDeadline !== bestDeadline) {
      if (candidateDeadline < bestDeadline) bestIndex = i;
      continue;
    }
    const candidateRank = PRIORITY_RANK[candidate.priority];
    const bestRank = PRIORITY_RANK[best.priority];
    if (candidateRank !== bestRank) {
      if (candidateRank < bestRank) bestIndex = i;
      continue;
    }
    const candidateMatches = locationMatches(candidate.location, windowTag);
    const bestMatches = locationMatches(best.location, windowTag);
    if (candidateMatches !== bestMatches) {
      if (candidateMatches) bestIndex = i;
      continue;
    }
    if (duration > bestDuration) bestIndex = i; // best-fit: use up more of the remaining space
  }
  return bestIndex;
}

/**
 * The single best task for an ad-hoc window of free time — e.g. "what
 * should I do with a 15-minute break?" — using the same ranking as
 * assignTasks, without committing anything. windowTag defaults to null (no
 * particular place), which excludes Traveling-tagged tasks (you didn't say
 * you're traveling) but still allows place-tagged and untagged ones.
 */
export function pickBestTask<T extends PlanTask>(candidates: T[], remainingMinutes: number, windowTag: string | null = null): T | null {
  const index = pickBestCandidateIndex(candidates, remainingMinutes, windowTag);
  return index === -1 ? null : candidates[index];
}

/**
 * Greedily slots tasks into free windows, processed chronologically. Within
 * each window, repeatedly picks the best-fitting eligible task (see
 * pickBestCandidateIndex) until nothing left in the queue is both eligible
 * and fits, then moves to the next window. A task too big (or too
 * place-specific) for every window simply never gets picked and ends up in
 * unplacedIds.
 */
export function assignTasks(windows: LocatedWindow[], tasks: PlanTask[]): { placements: Placement[]; unplacedIds: string[] } {
  const queue = [...tasks];
  const placements: Placement[] = [];
  const orderedWindows = [...windows].sort((a, b) => a.startAt.getTime() - b.startAt.getTime());

  for (const window of orderedWindows) {
    let cursor = window.startAt;
    for (;;) {
      const remainingMinutes = (window.endAt.getTime() - cursor.getTime()) / 60_000;
      if (remainingMinutes <= 0 || queue.length === 0) break;

      const bestIndex = pickBestCandidateIndex(queue, remainingMinutes, window.locationTag);
      if (bestIndex === -1) break; // nothing left in the queue is eligible for this window

      const [task] = queue.splice(bestIndex, 1);
      const duration = task.estimatedMinutes ?? DEFAULT_TASK_MINUTES;
      const startAt = cursor;
      const endAt = new Date(cursor.getTime() + duration * 60_000);
      placements.push({ taskId: task.id, startAt, endAt });
      cursor = endAt;
    }
  }

  return { placements, unplacedIds: queue.map((t) => t.id) };
}
