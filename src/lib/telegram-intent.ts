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

/** Removes the matched date/time phrase from the message, leaving a usable event title. */
function extractTitle(text: string, matchIndex: number, matchText: string): string {
  const before = text.slice(0, matchIndex);
  const after = text.slice(matchIndex + matchText.length);
  return `${before} ${after}`
    .replace(/^\s*(on|at|for|next|this|,|-)\s+/i, "")
    .replace(/\s+(on|at|for|next|this)\s*$/i, "")
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

  const title = extractTitle(text, result.index, result.text) || "Event";
  return { kind: "create_event", title, startAt: start.toISOString(), endAt: endAt.toISOString(), allDay };
}
