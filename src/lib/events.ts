export const EVENTS_FEED_URL = "https://compass.trailforged.org/feed/troop-events.json";

export interface TroopEventWhen {
  month: string; // e.g. "September"
  day_type: "weekday" | "weekend" | string;
  multi_day: boolean;
  span: string; // e.g. "single day", "multiple days"
}

export interface TroopEventImage {
  url?: string;
  alt?: string;
  credit?: string;
  license?: string;
}

export interface TroopEvent {
  id: string;
  title: string;
  category: string;
  when: TroopEventWhen;
  description: string;
  image: TroopEventImage;
  index: number; // feed's own chronological ordering — no absolute date is provided
}

interface FeedResponse {
  events: TroopEvent[];
}

/**
 * Build-time fetch of the troop's live Trail Life Compass events feed.
 * Returns an empty array on any failure so the section can fall back to the
 * local placeholder data instead of breaking the build.
 *
 * The feed only gives month-level precision (no day/year) — `index` is the
 * feed's own upcoming-first ordering, so we sort on that instead of a date.
 */
export async function getUpcomingHighlights(limit = 4): Promise<TroopEvent[]> {
  try {
    const res = await fetch(EVENTS_FEED_URL);
    if (!res.ok) throw new Error(`Feed responded ${res.status}`);

    const data = (await res.json()) as FeedResponse;

    return data.events
      .slice()
      .sort((a, b) => a.index - b.index)
      .slice(0, limit);
  } catch (error) {
    console.warn("[events] Could not fetch the troop events feed at build time:", error);
    return [];
  }
}
