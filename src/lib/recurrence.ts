// Native recurring events are materialized: creating one writes out every
// occurrence as its own Event row up front (same convention the Google/Graph
// sync already uses for recurring events, since both fetch with recurrences
// expanded), rather than storing one rule and expanding it at read time. Rows
// in the same series share `recurringEventId` (a generated series id, not a
// provider id) and carry the same human-readable `recurrenceRule` string.

export type RecurrenceFreq = "DAILY" | "WEEKLY" | "MONTHLY" | "YEARLY";

export type RecurrenceInput = {
  freq: RecurrenceFreq;
  count?: number;
  until?: string; // ISO date-time
};

export const MAX_OCCURRENCES = 365;

export function expandOccurrences(
  startAt: Date,
  endAt: Date,
  recurrence: RecurrenceInput,
): { startAt: Date; endAt: Date }[] {
  const durationMs = endAt.getTime() - startAt.getTime();
  const untilDate = recurrence.until ? new Date(recurrence.until) : null;
  const maxCount = Math.min(recurrence.count ?? MAX_OCCURRENCES, MAX_OCCURRENCES);

  const occurrences: { startAt: Date; endAt: Date }[] = [];
  const current = new Date(startAt);
  for (let i = 0; i < maxCount; i++) {
    if (untilDate && current > untilDate) break;
    occurrences.push({ startAt: new Date(current), endAt: new Date(current.getTime() + durationMs) });

    switch (recurrence.freq) {
      case "DAILY":
        current.setDate(current.getDate() + 1);
        break;
      case "WEEKLY":
        current.setDate(current.getDate() + 7);
        break;
      case "MONTHLY":
        current.setMonth(current.getMonth() + 1);
        break;
      case "YEARLY":
        current.setFullYear(current.getFullYear() + 1);
        break;
    }
  }
  return occurrences;
}

function toIcsUtc(d: Date): string {
  return d.toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
}

function parseIcsUtc(s: string): Date | null {
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z?$/.exec(s);
  if (!m) return null;
  const [y, mo, d, h, mi, se] = m.slice(1).map(Number);
  return new Date(Date.UTC(y, mo - 1, d, h, mi, se));
}

export function buildRecurrenceRule(recurrence: RecurrenceInput): string {
  const parts = [`FREQ=${recurrence.freq}`];
  if (recurrence.count) parts.push(`COUNT=${recurrence.count}`);
  else if (recurrence.until) parts.push(`UNTIL=${toIcsUtc(new Date(recurrence.until))}`);
  return parts.join(";");
}

const FREQ_LABEL: Record<string, string> = { DAILY: "day", WEEKLY: "week", MONTHLY: "month", YEARLY: "year" };

/** Human-readable summary of a stored recurrenceRule, e.g. "Repeats every week, 10 times". */
export function describeRecurrence(rrule: string | null | undefined): string | null {
  if (!rrule) return null;
  const parts = Object.fromEntries(rrule.split(";").map((p) => p.split("=") as [string, string]));
  const freq = FREQ_LABEL[parts.FREQ] ?? parts.FREQ?.toLowerCase() ?? "period";

  if (parts.COUNT) return `Repeats every ${freq}, ${parts.COUNT} times`;
  if (parts.UNTIL) {
    const until = parseIcsUtc(parts.UNTIL);
    if (until) {
      return `Repeats every ${freq} until ${until.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}`;
    }
  }
  return `Repeats every ${freq}`;
}
