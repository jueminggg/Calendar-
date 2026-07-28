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
  connectionLabel: string | null;
  editable: boolean;
  recurrenceRule: string | null;
  recurringEventId: string | null;
};
