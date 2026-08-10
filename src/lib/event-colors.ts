export const SOURCE_COLORS: Record<string, string> = {
  GOOGLE: "#4285F4",
  MICROSOFT: "#7B83EB",
  APPLE: "#8E8E93",
  NATIVE: "#EC4899",
};

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

/** e.g. "iCloud", "Google", "SS" (screenshot import), or "Manual" for a typed-in native event. */
export function eventSourceTag(event: { source: string; importedVia?: string | null }): string {
  if (event.source === "NATIVE") {
    return event.importedVia === "screenshot" ? "SS" : "Manual";
  }
  return SHORT_SOURCE_LABELS[event.source] ?? event.source;
}

/** Full-length version of eventSourceTag, for tooltips/detail views. */
export function eventSourceFullLabel(event: { source: string; importedVia?: string | null }): string {
  if (event.source === "NATIVE") {
    return event.importedVia === "screenshot" ? "Added from a screenshot" : "Manually added";
  }
  return SOURCE_LABELS[event.source] ?? event.source;
}
