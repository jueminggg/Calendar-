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

/** Swatches offered for your own events. A plain spectrum plus a neutral,
 *  spaced far enough apart to stay distinguishable at chip size. */
export const EVENT_COLOR_CHOICES: { name: string; value: string }[] = [
  { name: "Red", value: "#E23D3D" },
  { name: "Orange", value: "#E8821E" },
  { name: "Yellow", value: "#E3B505" },
  { name: "Green", value: "#2E9E5B" },
  { name: "Teal", value: "#14908C" },
  { name: "Blue", value: "#2D6FD8" },
  { name: "Indigo", value: "#5B4BC4" },
  { name: "Violet", value: "#8E44AD" },
  { name: "Pink", value: "#EC4899" },
  { name: "Slate", value: "#5B6673" },
];

/** How faint a synced event's tint is. Alpha rather than opacity, so it
 *  composites over whichever background the theme paints and leaves the
 *  label at full strength instead of fading it too. */
const SYNCED_TINT = 0.22;

function withAlpha(hex: string, alpha: number): string {
  const f = hex.replace("#", "");
  const full = f.length === 3 ? f.split("").map((c) => c + c).join("") : f;
  const [r, g, b] = [0, 2, 4].map((o) => parseInt(full.slice(o, o + 2), 16));
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/**
 * The style for an event chip.
 *
 * Events you added here are solid in their own colour, so they read as the
 * thing you act on. Events synced from Google, Outlook or iCloud get a faint
 * tint of their source colour with a bar down the left edge -- the tint alone
 * leaves two pale sources hard to tell apart.
 *
 * Synced chips deliberately return no `color`, leaving their label to a
 * theme-aware class on the element; a fixed ink would fail in one theme,
 * since the tint composites over whatever is behind it.
 */
export function eventChipStyle(event: { source: string; color?: string | null; calendarColor?: string | null }): {
  background: string;
  color?: string;
  fontWeight: number;
  boxShadow?: string;
} {
  const own = event.source === "NATIVE";
  const base = (own ? event.color : null) ?? SOURCE_COLORS[event.source] ?? event.calendarColor ?? "#6B7280";

  if (own) {
    return { background: base, color: readableTextOn(base), fontWeight: 600 };
  }
  return {
    background: withAlpha(base, SYNCED_TINT),
    fontWeight: 400,
    boxShadow: `inset 3px 0 0 0 ${base}`,
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
