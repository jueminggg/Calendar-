import * as chrono from "chrono-node";
import { DateTime } from "luxon";
import { DEFAULT_TASK_MINUTES } from "@/lib/planDay";

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
  estimatedMinutes: number | null;
};

export type GoalIntent = {
  kind: "add_goal";
  title: string;
  sessions: number;
  estimatedMinutes: number;
  location: string | null;
  deadline: string | null;
  priority: "LOW" | "MED" | "HIGH";
};

export type WhatNextIntent = { kind: "what_next"; at: string; durationMinutes: number | null };

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

// Phrases that mark a message as a flexible to-do (or multi-session goal)
// rather than a fixed appointment or a note — checked before event/idea
// parsing, since e.g. "need to call mom tomorrow" is a to-do with a
// deadline, not an all-day calendar event.
const TASK_TRIGGER = /^(i\s+)?(need to|have to|gotta|should|must)\b|^(todo|to-do|task|goal)\s*[:\-]?\s*|\bremember to\b|\bdon'?t forget to\b/i;

const LOCATION_KEYWORDS: [RegExp, string][] = [
  [/\b(while\s+)?travel(l)?ing\b|\bcommut(e|ing)\b|\bon the (way|go)\b|\bin transit\b/i, "Traveling"],
  [/\b(in|at)\s+(the\s+)?office\b|\boffice\b/i, "Office"],
  [/\b(in|at)\s+(my\s+)?room\b|\b(my\s+)?room\b/i, "Room"],
  [/\b(at\s+)?home\b/i, "Home"],
];

const HIGH_PRIORITY_WORDS = /\b(urgent|asap|important|high priority|critical)\b/i;
const LOW_PRIORITY_WORDS = /\b(whenever|low priority|no rush|no hurry|eventually)\b/i;

const DURATION_PATTERN = /\bhalf an?\s+hour\b|\ban?\s+hour\b|\b(\d+)\s*(minutes|minute|mins|min)\b|\b(\d+)\s*(hours|hour|hrs|hr)\b/i;
const COUNT_PATTERN = /\b(\d+)\s*(times|sessions|reps?)\b|\b(\d+)\s*x\b|\bx\s*(\d+)\b/i;

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

/** "20 min", "20 mins", "2 hours", "half an hour", "an hour" -> minutes. */
function extractDuration(text: string): { minutes: number | null; remainder: string } {
  const match = DURATION_PATTERN.exec(text);
  if (!match) return { minutes: null, remainder: text };
  const phrase = match[0].toLowerCase();
  let minutes: number;
  if (/half/.test(phrase)) {
    minutes = 30;
  } else if (/hour|hr/.test(phrase)) {
    const n = parseInt(phrase, 10);
    minutes = (Number.isNaN(n) ? 1 : n) * 60;
  } else {
    const n = parseInt(phrase, 10);
    minutes = Number.isNaN(n) ? DEFAULT_TASK_MINUTES : n;
  }
  const remainder = (text.slice(0, match.index) + " " + text.slice(match.index + match[0].length)).replace(/\s{2,}/g, " ").trim();
  return { minutes, remainder };
}

/** "4 times", "4 sessions", "4x", "x4" -> a repeat count. */
function extractCount(text: string): { count: number | null; remainder: string } {
  const match = COUNT_PATTERN.exec(text);
  if (!match) return { count: null, remainder: text };
  const n = Number(match[1] ?? match[3] ?? match[4]);
  const remainder = (text.slice(0, match.index) + " " + text.slice(match.index + match[0].length)).replace(/\s{2,}/g, " ").trim();
  return { count: Number.isFinite(n) && n > 0 ? n : null, remainder };
}

/** Tidies up leftover filler ("each", dangling commas/whitespace) once duration/count/location/etc. spans are stripped out of a message. */
function cleanTitle(text: string, fallback: string): string {
  return (
    text
      .replace(/\beach\b/gi, "")
      .replace(/\s*,\s*,\s*/g, ", ")
      .replace(/^[,.\s]+|[,.\s]+$/g, "")
      .replace(/\s{2,}/g, " ")
      .trim() || fallback
  );
}

/** Shared location/priority/deadline extraction used by both parseTaskIntent and parseGoalIntent. */
function extractTaskFields(remainder: string, opts: { timezone: string; now: Date }) {
  const { location, remainder: afterLocation } = extractLocation(remainder);
  const { priority, remainder: afterPriority } = extractPriority(afterLocation);

  let deadline: string | null = null;
  let title = afterPriority;
  const offsetMinutes = DateTime.fromJSDate(opts.now).setZone(opts.timezone).offset;
  const results = chrono.parse(afterPriority, { instant: opts.now, timezone: offsetMinutes }, { forwardDate: true });
  if (results.length > 0) {
    const result = results[0];
    const hasHour = result.start.isCertain("hour");
    const hasDay = result.start.isCertain("day") || result.start.isCertain("weekday");
    if (hasHour || hasDay || !BARE_DAYPART_WORDS.has(result.text.trim().toLowerCase())) {
      deadline = result.start.date().toISOString();
      title = stripSpan(afterPriority, result.index, result.text);
    }
  }

  return { location, priority, deadline, title };
}

/**
 * Detects a flexible to-do ("need to...", "remember to...", "todo: ...") and
 * pulls out a location tag (Office/Home/Room/Traveling), an estimated
 * duration, a deadline (via chrono, if any date/time is mentioned), and a
 * priority — all via free local heuristics, same no-API-cost approach as
 * parseMessageIntent. Returns null if the message doesn't look like a
 * to-do, so the caller falls through to event/idea handling.
 */
export function parseTaskIntent(text: string, opts: { timezone: string; now: Date; force?: boolean }): TaskIntent | null {
  const trigger = TASK_TRIGGER.exec(text);
  if (!trigger && !opts.force) return null;

  const afterTrigger = trigger ? (text.slice(0, trigger.index) + " " + text.slice(trigger.index + trigger[0].length)).trim() : text;
  const { minutes: estimatedMinutes, remainder } = extractDuration(afterTrigger);
  const { location, priority, deadline, title } = extractTaskFields(remainder, opts);

  return {
    kind: "add_task",
    title: cleanTitle(title, "To-do"),
    location,
    deadline,
    priority,
    estimatedMinutes,
  };
}

/**
 * Like parseTaskIntent, but for a message that also names a repeat count
 * ("4 times", "3 sessions", "x5") — e.g. "need to practice for the exam 4
 * times, 20 min each, by next friday". Returns null if no count is found
 * (including when the message isn't a to-do at all), so the caller falls
 * back to parseTaskIntent for a plain single to-do.
 */
export function parseGoalIntent(text: string, opts: { timezone: string; now: Date; force?: boolean }): GoalIntent | null {
  const trigger = TASK_TRIGGER.exec(text);
  if (!trigger && !opts.force) return null;

  const afterTrigger = trigger ? (text.slice(0, trigger.index) + " " + text.slice(trigger.index + trigger[0].length)).trim() : text;
  const { count, remainder: afterCount } = extractCount(afterTrigger);
  if (count === null) return null;

  const { minutes: estimatedMinutes, remainder: afterDuration } = extractDuration(afterCount);
  const { location, priority, deadline, title } = extractTaskFields(afterDuration, opts);

  return {
    kind: "add_goal",
    title: cleanTitle(title, "Goal"),
    sessions: count,
    estimatedMinutes: estimatedMinutes ?? DEFAULT_TASK_MINUTES,
    location,
    deadline,
    priority,
  };
}

const WHAT_NEXT_PATTERN = /^(what should i do|what'?s next|what do i have|what am i doing)\b/i;

/**
 * Detects "what should I do (at 3pm)? (I have a 15 min break)" — defaults
 * to right now if no time is mentioned, and durationMinutes is null unless
 * a break/duration length is named.
 */
export function parseWhatNextIntent(text: string, opts: { timezone: string; now: Date }): WhatNextIntent | null {
  if (!WHAT_NEXT_PATTERN.test(text.trim())) return null;

  const { minutes: durationMinutes, remainder } = extractDuration(text);

  const offsetMinutes = DateTime.fromJSDate(opts.now).setZone(opts.timezone).offset;
  const results = chrono.parse(remainder, { instant: opts.now, timezone: offsetMinutes }, { forwardDate: true });
  const at = results.length > 0 ? results[0].start.date() : opts.now;
  return { kind: "what_next", at: at.toISOString(), durationMinutes };
}
