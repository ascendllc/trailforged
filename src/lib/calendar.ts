import ical from "node-ical";

export const CALENDAR_FEED_URL = "https://www.traillifeconnect.com/icalendar/tkwegrrlcbyr/na/public";

export interface CalendarEvent {
  uid: string;
  title: string;
  start: Date;
  end?: Date;
  location?: string;
}

/**
 * Build-time fetch of the troop's public Trail Life Connect feed (Section 8.2, Option A).
 * Returns an empty array on any failure so the page can fall back to the raw feed link
 * instead of breaking the build.
 */
export async function getUpcomingEvents(limit = 10): Promise<CalendarEvent[]> {
  try {
    const data = await ical.async.fromURL(CALENDAR_FEED_URL);
    const now = new Date();

    const events: CalendarEvent[] = Object.values(data)
      .filter((entry): entry is ical.VEvent => entry.type === "VEVENT")
      .map((entry) => ({
        uid: entry.uid,
        title: entry.summary ?? "Troop Event",
        start: entry.start as Date,
        end: entry.end as Date | undefined,
        location: entry.location,
      }))
      .filter((event) => event.start && event.start >= now)
      .sort((a, b) => a.start.getTime() - b.start.getTime());

    return events.slice(0, limit);
  } catch (error) {
    console.warn("[calendar] Could not fetch Trail Life Connect feed at build time:", error);
    return [];
  }
}
