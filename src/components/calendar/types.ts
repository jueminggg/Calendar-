export type CalendarEvent = {
  id: string;
  source: "GOOGLE" | "MICROSOFT" | "APPLE" | "NATIVE";
  title: string;
  description: string | null;
  location: string | null;
  startAt: string;
  endAt: string;
  allDay: boolean;
  status: "CONFIRMED" | "TENTATIVE" | "CANCELLED";
  organizer: string | null;
  attendees: { email: string; name?: string; responseStatus?: string }[] | null;
  calendarName: string;
  calendarColor: string | null;
  color: string | null;
  connectionLabel: string | null;
  editable: boolean;
  recurrenceRule: string | null;
  recurringEventId: string | null;
  reminderMinutesBefore: number | null;
  importedVia: string | null;
  /** "task" entries are time-blocked to-dos rendered here; they are not Event
   *  rows, so they cannot be edited, dragged or deleted from the calendar. */
  kind: "event" | "task";
  done: boolean;
};
