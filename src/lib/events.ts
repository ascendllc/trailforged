export const EVENTS_FEED_URL = "https://tl-compass.praesyn.com/feed/troop-events.json";

export interface TroopEvent {
  id: string;
  title: string;
  category: string;
  date: string; // ISO date
  when: string; // e.g. "Monday, September 14"
  relative: string; // e.g. "in 2 weeks"
  description: string;
}

interface FeedResponse {
  events: TroopEvent[];
}

/**
 * Build-time fetch of the troop's live Trail Life Compass events feed.
 * Returns an empty array on any failure so the section can fall back to the
 * local placeholder data instead of breaking the build.
 */
export async function getUpcomingHighlights(limit = 4): Promise<TroopEvent[]> {
  try {
    const res = await fetch(EVENTS_FEED_URL);
    if (!res.ok) throw new Error(`Feed responded ${res.status}`);

    const data = (await res.json()) as FeedResponse;
    const today = new Date().toISOString().slice(0, 10);

    return data.events
      .filter((event) => event.date >= today)
      .sort((a, b) => a.date.localeCompare(b.date))
      .slice(0, limit);
  } catch (error) {
    console.warn("[events] Could not fetch the troop events feed at build time:", error);
    return [];
  }
}
