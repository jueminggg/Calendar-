import * as chrono from "chrono-node";
import { DateTime } from "luxon";

export type EventIntent = {
  kind: "create_event";
  title: string;
  startAt: string;
  endAt: string;
  allDay: boolean;
};

export type AvailabilityIntent = {
  kind: "check_availability";
  startAt: string;
  endAt: string;
};

export type TaskIntent = {
  kind: "add_task";
  title: string;
  location: string | null;
  deadline: string | null;
  priority: "LOW" | "MED" | "HIGH";
};

export type WhatNextIntent = { kind: "what_next"; at: string };

export type MessageIntent = EventIntent | AvailabilityIntent | { kind: "none" };

const AVAILABILITY_KEYWORDS = /\b(free|busy|available|slot|open)\b/i;
const AVAILABILITY_LEAD_IN = /^(am i|do i have|is there|any|what'?s my)\b/i;

// A match consisting of nothing but one of these words (no weekday, explicit
// day, or specific hour attached) is too weak a signal on its own — e.g.
// "morning routine" or "plans for tonight" shouldn't turn a note into an
// event just because chrono can resolve "morning"/"tonight" to a rough time.
const BARE_DAYPART_WORDS = new Set(["morning", "afternoon", "evening", "night", "tonight", "today", "noon", "midnight"]);

function looksLikeAvailabilityQuestion(text: string): boolean {
  return AVAILABILITY_KEYWORDS.test(text) || AVAILABILITY_LEAD_IN.test(text.trim());
}

/** Removes the matched date/time phrase from the message, leaving usable remaining text. */
function stripSpan(text: string, matchIndex: number, matchText: string): string {
  const before = text.slice(0, matchIndex);
  const after = text.slice(matchIndex + matchText.length);
  return `${before} ${after}`
    .replace(/^\s*(on|at|for|next|this|by|before|,|-)\s+/i, "")
    .replace(/\s+(on|at|for|next|this|by|before)\s*$/i, "")
    .replace(/\s{2,}/g, " ")
    .replace(/[,\s]+$/, "")
    .trim();
}

/**
 * Free, local (no API calls) parsing of a Telegram message into an
 * event-creation request, an availability check, or neither (treated as a
 * plain idea). Uses chrono-node for date/time extraction plus keyword
 * heuristics for intent — less flexible than an LLM with unusual phrasing,
 * but has no ongoing cost.
 */
export function parseMessageIntent(text: string, opts: { timezone: string; now: Date }): MessageIntent {
  // chrono only understands numeric UTC offsets (in minutes) or timezone
  // abbreviations, not IANA names — compute the real offset for this
  // instant so relative dates ("today", "3pm") resolve in the user's zone
  // instead of the server's.
  const offsetMinutes = DateTime.fromJSDate(opts.now).setZone(opts.timezone).offset;

  const results = chrono.parse(text, { instant: opts.now, timezone: offsetMinutes }, { forwardDate: true });
  if (results.length === 0) return { kind: "none" };

  const result = results[0];
  const hasHour = result.start.isCertain("hour");
  const hasDay = result.start.isCertain("day") || result.start.isCertain("weekday");
  if (!hasHour && !hasDay && BARE_DAYPART_WORDS.has(result.text.trim().toLowerCase())) {
    return { kind: "none" };
  }

  const start = result.start.date();
  const allDay = !hasHour;

  let endAt: Date;
  if (result.end) {
    endAt = result.end.date();
  } else if (allDay) {
    endAt = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  } else {
    endAt = new Date(start.getTime() + 60 * 60 * 1000);
  }

  if (looksLikeAvailabilityQuestion(text)) {
    return { kind: "check_availability", startAt: start.toISOString(), endAt: endAt.toISOString() };
  }

  const title = stripSpan(text, result.index, result.text) || "Event";
  return { kind: "create_event", title, startAt: start.toISOString(), endAt: endAt.toISOString(), allDay };
}

// Phrases that mark a message as a flexible to-do rather than a fixed
// appointment or a note — checked before event/idea parsing, since e.g.
// "need to call mom tomorrow" is a to-do with a deadline, not an all-day
// calendar event.
const TASK_TRIGGER = /^(i\s+)?(need to|have to|gotta|should|must)\b|^(todo|to-do|task)\s*[:\-]?\s*|\bremember to\b|\bdon'?t forget to\b/i;

const LOCATION_KEYWORDS: [RegExp, string][] = [
  [/\b(while\s+)?travel(l)?ing\b|\bcommut(e|ing)\b|\bon the (way|go)\b|\bin transit\b/i, "Traveling"],
  [/\b(in|at)\s+(the\s+)?office\b|\boffice\b/i, "Office"],
  [/\b(in|at)\s+(my\s+)?room\b|\b(my\s+)?room\b/i, "Room"],
  [/\b(at\s+)?home\b/i, "Home"],
];

const HIGH_PRIORITY_WORDS = /\b(urgent|asap|important|high priority|critical)\b/i;
const LOW_PRIORITY_WORDS = /\b(whenever|low priority|no rush|no hurry|eventually)\b/i;

function extractLocation(text: string): { location: string | null; remainder: string } {
  for (const [pattern, tag] of LOCATION_KEYWORDS) {
    const match = pattern.exec(text);
    if (match) {
      const remainder = (text.slice(0, match.index) + " " + text.slice(match.index + match[0].length)).replace(/\s{2,}/g, " ").trim();
      return { location: tag, remainder };
    }
  }
  return { location: null, remainder: text };
}

function extractPriority(text: string): { priority: "LOW" | "MED" | "HIGH"; remainder: string } {
  const high = HIGH_PRIORITY_WORDS.exec(text);
  if (high) {
    const remainder = (text.slice(0, high.index) + " " + text.slice(high.index + high[0].length)).replace(/\s{2,}/g, " ").trim();
    return { priority: "HIGH", remainder };
  }
  const low = LOW_PRIORITY_WORDS.exec(text);
  if (low) {
    const remainder = (text.slice(0, low.index) + " " + text.slice(low.index + low[0].length)).replace(/\s{2,}/g, " ").trim();
    return { priority: "LOW", remainder };
  }
  return { priority: "MED", remainder: text };
}

/**
 * Detects a flexible to-do ("need to...", "remember to...", "todo: ...") and
 * pulls out a location tag (Office/Home/Room/Traveling), a deadline (via
 * chrono, if any date/time is mentioned), and a priority — all via free
 * local heuristics, same no-API-cost approach as parseMessageIntent. Returns
 * null if the message doesn't look like a to-do, so the caller falls
 * through to event/idea handling.
 */
export function parseTaskIntent(text: string, opts: { timezone: string; now: Date; force?: boolean }): TaskIntent | null {
  const trigger = TASK_TRIGGER.exec(text);
  if (!trigger && !opts.force) return null;

  let remainder = trigger ? (text.slice(0, trigger.index) + " " + text.slice(trigger.index + trigger[0].length)).trim() : text;

  const { location, remainder: afterLocation } = extractLocation(remainder);
  remainder = afterLocation;
  const { priority, remainder: afterPriority } = extractPriority(remainder);
  remainder = afterPriority;

  let deadline: string | null = null;
  const offsetMinutes = DateTime.fromJSDate(opts.now).setZone(opts.timezone).offset;
  const results = chrono.parse(remainder, { instant: opts.now, timezone: offsetMinutes }, { forwardDate: true });
  if (results.length > 0) {
    const result = results[0];
    const hasHour = result.start.isCertain("hour");
    const hasDay = result.start.isCertain("day") || result.start.isCertain("weekday");
    if (hasHour || hasDay || !BARE_DAYPART_WORDS.has(result.text.trim().toLowerCase())) {
      deadline = result.start.date().toISOString();
      remainder = stripSpan(remainder, result.index, result.text);
    }
  }

  const title = remainder.replace(/^[,.\s]+|[,.\s]+$/g, "").trim() || "To-do";
  return { kind: "add_task", title, location, deadline, priority };
}

const WHAT_NEXT_PATTERN = /^(what should i do|what'?s next|what do i have|what am i doing)\b/i;

/** Detects "what should I do (at 3pm)?" — defaults to right now if no time is mentioned. */
export function parseWhatNextIntent(text: string, opts: { timezone: string; now: Date }): WhatNextIntent | null {
  if (!WHAT_NEXT_PATTERN.test(text.trim())) return null;

  const offsetMinutes = DateTime.fromJSDate(opts.now).setZone(opts.timezone).offset;
  const results = chrono.parse(text, { instant: opts.now, timezone: offsetMinutes }, { forwardDate: true });
  const at = results.length > 0 ? results[0].start.date() : opts.now;
  return { kind: "what_next", at: at.toISOString() };
}
