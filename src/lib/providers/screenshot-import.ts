import Anthropic from "@anthropic-ai/sdk";

export type ParsedEvent = {
  title: string;
  description?: string;
  location?: string;
  startAt: string;
  endAt: string;
  allDay: boolean;
};

const SUPPORTED_MEDIA_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"] as const;
type SupportedMediaType = (typeof SUPPORTED_MEDIA_TYPES)[number];

function isSupportedMediaType(value: string): value is SupportedMediaType {
  return (SUPPORTED_MEDIA_TYPES as readonly string[]).includes(value);
}

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} environment variable is not set`);
  return value;
}

const EXTRACT_EVENTS_TOOL: Anthropic.Tool = {
  name: "extract_events",
  description: "Records the calendar events found in the screenshot.",
  input_schema: {
    type: "object",
    properties: {
      events: {
        type: "array",
        items: {
          type: "object",
          properties: {
            title: { type: "string" },
            description: { type: "string" },
            location: { type: "string" },
            startAt: { type: "string", description: "ISO 8601 date-time, including UTC offset" },
            endAt: { type: "string", description: "ISO 8601 date-time, including UTC offset" },
            allDay: { type: "boolean" },
          },
          required: ["title", "startAt", "endAt", "allDay"],
        },
      },
    },
    required: ["events"],
  },
};

/**
 * Uses Claude's vision capability to read a calendar screenshot (e.g. a work
 * Outlook calendar the user can view but can't connect via OAuth) and extract
 * discrete events as structured data, so they can be reviewed and imported as
 * native events rather than synced live.
 */
export async function parseEventsFromImage(
  imageBase64: string,
  mediaType: string,
  opts: { timezone: string; referenceDate: Date },
): Promise<ParsedEvent[]> {
  if (!isSupportedMediaType(mediaType)) {
    throw new Error(`Unsupported image type: ${mediaType}`);
  }

  const client = new Anthropic({ apiKey: requireEnv("ANTHROPIC_API_KEY") });

  const message = await client.messages.create({
    model: "claude-opus-5",
    max_tokens: 4096,
    tools: [EXTRACT_EVENTS_TOOL],
    tool_choice: { type: "tool", name: "extract_events" },
    messages: [
      {
        role: "user",
        content: [
          {
            type: "image",
            source: { type: "base64", media_type: mediaType, data: imageBase64 },
          },
          {
            type: "text",
            text: `This is a screenshot of a calendar app (Outlook, Google Calendar, or similar). Extract every distinct event visible.

Today's date is ${opts.referenceDate.toISOString().slice(0, 10)} and the user's timezone is ${opts.timezone}. Resolve any relative or partial dates (a day-of-week header with no year, "today", a week view, etc.) using that reference date and timezone, and return startAt/endAt as full ISO 8601 date-times with a UTC offset.

If an event's exact end time isn't shown, estimate one hour after the start. If it's clearly an all-day event, set allDay true and use midnight-to-midnight in the user's timezone. Skip anything that isn't a real event (day headers, gridlines, empty slots, "no events" placeholders).`,
          },
        ],
      },
    ],
  });

  const toolUse = message.content.find(
    (block): block is Anthropic.ToolUseBlock => block.type === "tool_use",
  );
  if (!toolUse) return [];

  const events = (toolUse.input as { events?: ParsedEvent[] }).events ?? [];
  return events.filter((e) => e.title && e.startAt && e.endAt);
}
