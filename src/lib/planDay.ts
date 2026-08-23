// Pure, synchronous scheduling logic for "Plan my day" — kept free of I/O
// (DB, HTTP) so it's easy to reason about and test; the API route wires this
// together with Prisma and the Distance Matrix lookup in travelTime.ts.

export const DEFAULT_TASK_MINUTES = 30;
export const DEFAULT_DAY_START_HOUR = 7;
export const DEFAULT_DAY_END_HOUR = 22;

export type FixedBlock = { startAt: Date; endAt: Date; location: string | null };
export type FreeWindow = { startAt: Date; endAt: Date };
export type RawWindow = FreeWindow & { beforeLocation: string | null; afterLocation: string | null };
export type PlanPriority = "LOW" | "MED" | "HIGH";
export type PlanTask = { id: string; estimatedMinutes: number | null; deadline: Date | null; priority: PlanPriority };
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
 * Reserves a travel-time buffer at the end of a window (right before the
 * next fixed block), on the reasoning that you stay put until you need to
 * leave to make it to wherever's next. Returns null if the buffer consumes
 * the entire window.
 */
export function applyTravelBuffer(window: FreeWindow, bufferMinutes: number): FreeWindow | null {
  if (bufferMinutes <= 0) return window;
  const endAt = new Date(window.endAt.getTime() - bufferMinutes * 60_000);
  if (endAt.getTime() <= window.startAt.getTime()) return null;
  return { startAt: window.startAt, endAt };
}

/**
 * Greedily slots tasks into free windows, processed chronologically. Within
 * each window, repeatedly picks the best-fitting eligible task — ranked by
 * (1) earliest deadline (nulls last), (2) higher priority, (3) the duration
 * that best fills the remaining space — until nothing left in the queue
 * fits, then moves to the next window. A task too big for every window
 * simply never gets picked and ends up in unplacedIds.
 */
export function assignTasks(windows: FreeWindow[], tasks: PlanTask[]): { placements: Placement[]; unplacedIds: string[] } {
  const queue = [...tasks];
  const placements: Placement[] = [];
  const orderedWindows = [...windows].sort((a, b) => a.startAt.getTime() - b.startAt.getTime());

  for (const window of orderedWindows) {
    let cursor = window.startAt;
    for (;;) {
      const remainingMinutes = (window.endAt.getTime() - cursor.getTime()) / 60_000;
      if (remainingMinutes <= 0 || queue.length === 0) break;

      let bestIndex = -1;
      for (let i = 0; i < queue.length; i++) {
        const candidate = queue[i];
        const duration = candidate.estimatedMinutes ?? DEFAULT_TASK_MINUTES;
        if (duration > remainingMinutes) continue;

        if (bestIndex === -1) {
          bestIndex = i;
          continue;
        }
        const best = queue[bestIndex];
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
        if (duration > bestDuration) bestIndex = i; // best-fit: use up more of the remaining space
      }

      if (bestIndex === -1) break; // nothing left in the queue fits this window

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
