export const SOURCE_COLORS: Record<string, string> = {
  GOOGLE: "#BC8F8F",
  MICROSOFT: "#7B83EB",
  APPLE: "#D8BFD8",
  NATIVE: "#EC4899",
};

const DARK_INK = "#1F2328";
const LIGHT_INK = "#FFFFFF";

/**
 * Picks whichever of dark or white text reads better on a chip of this
 * colour. The chips used to hardcode white, which only worked while every
 * source colour was dark -- white on a pastel like #D8BFD8 lands under 2:1.
 */
export function readableTextOn(background: string): string {
  const hex = background.replace("#", "").trim();
  const full = hex.length === 3 ? hex.split("").map((c) => c + c).join("") : hex;
  if (full.length !== 6 || /[^0-9a-f]/i.test(full)) return LIGHT_INK;

  const channel = (offset: number) => {
    const v = parseInt(full.slice(offset, offset + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  const luminance = 0.2126 * channel(0) + 0.7152 * channel(2) + 0.0722 * channel(4);

  const againstDark = (luminance + 0.05) / 0.05;
  const againstLight = 1.05 / (luminance + 0.05);
  return againstDark >= againstLight ? DARK_INK : LIGHT_INK;
}

/** How far a synced event is faded. Mild on purpose: the de-emphasised chips
 *  still clear 3:1 against their own text at this level, which a heavier fade
 *  would not -- receding is the goal, disappearing is not. */
const SYNCED_OPACITY = 0.8;

/**
 * The full style for an event chip. The source's colour wins over the
 * provider's own per-calendar colour, so "iCloud events look like this" holds
 * across every calendar -- the trade being that several calendars from one
 * provider no longer differ from each other.
 *
 * Events created in this app are the ones you actually act on, so they stay
 * at full strength with heavier text and a ring, while everything synced in
 * from elsewhere sits back.
 */
export function eventChipStyle(event: { source: string; calendarColor?: string | null }): {
  background: string;
  color: string;
  opacity: number;
  fontWeight: number;
  boxShadow?: string;
} {
  const background = SOURCE_COLORS[event.source] ?? event.calendarColor ?? "#6B7280";
  const own = event.source === "NATIVE";
  return {
    background,
    color: readableTextOn(background),
    opacity: own ? 1 : SYNCED_OPACITY,
    fontWeight: own ? 600 : 400,
    // Inset so the ring costs no layout, and tinted from the chip's own text
    // colour so it reads on a pale chip and a dark one alike.
    boxShadow: own ? `inset 0 0 0 1.5px ${readableTextOn(background)}66` : undefined,
  };
}

export const SOURCE_LABELS: Record<string, string> = {
  GOOGLE: "Google Calendar",
  MICROSOFT: "Outlook",
  APPLE: "iCloud",
  NATIVE: "This app",
};

// Short form for the "(...)" tag shown next to events in the calendar grids.
const SHORT_SOURCE_LABELS: Record<string, string> = {
  GOOGLE: "Google",
  MICROSOFT: "Outlook",
  APPLE: "iCloud",
};

/** e.g. "iCloud", "Google", "SS" (screenshot import), "Telegram", or "Manual" for a typed-in native event. */
export function eventSourceTag(event: { source: string; importedVia?: string | null }): string {
  if (event.source === "NATIVE") {
    if (event.importedVia === "screenshot") return "SS";
    if (event.importedVia === "telegram") return "Telegram";
    return "Manual";
  }
  return SHORT_SOURCE_LABELS[event.source] ?? event.source;
}

/** Full-length version of eventSourceTag, for tooltips/detail views. */
export function eventSourceFullLabel(event: { source: string; importedVia?: string | null }): string {
  if (event.source === "NATIVE") {
    if (event.importedVia === "screenshot") return "Added from a screenshot";
    if (event.importedVia === "telegram") return "Added via Telegram";
    return "Manually added";
  }
  return SOURCE_LABELS[event.source] ?? event.source;
}
