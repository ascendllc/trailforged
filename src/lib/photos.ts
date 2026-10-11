import { list } from "@vercel/blob";

export const PHOTO_PREFIX = "photos/";
export const THUMB_PREFIX = "thumbs/";
export const PHOTOS_PER_PAGE = 48;
export const TIME_ZONE = "America/Los_Angeles";

export const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

export interface Photo {
  pathname: string;
  url: string;
  thumbUrl: string;
  uploadedAt: Date;
  year: string;
  month: string;
}

export function isValidYear(value: string) {
  return /^\d{4}$/.test(value);
}

export function isValidMonth(value: string) {
  return /^(0[1-9]|1[0-2])$/.test(value);
}

export function monthName(month: string) {
  return MONTH_NAMES[Number(month) - 1] ?? month;
}

export function currentYearMonth(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: TIME_ZONE, year: "numeric", month: "2-digit" }).formatToParts(date);
  return {
    year: parts.find((p) => p.type === "year")?.value ?? String(date.getFullYear()),
    month: parts.find((p) => p.type === "month")?.value ?? "01",
  };
}

const PATH_PATTERN = /^photos\/(\d{4})\/(0[1-9]|1[0-2])\/[A-Za-z0-9_-]+\.jpg$/;

/** Lists every published photo under an optional folder prefix, newest first. */
export async function listPhotos(folder = ""): Promise<Photo[]> {
  const photos: Photo[] = [];
  let cursor: string | undefined;

  // Safety cap so a runaway store can't make a page hang.
  for (let page = 0; page < 20; page++) {
    const result = await list({ prefix: `${PHOTO_PREFIX}${folder}`, limit: 1000, cursor });
    for (const blob of result.blobs) {
      const match = PATH_PATTERN.exec(blob.pathname);
      if (!match) continue;
      photos.push({
        pathname: blob.pathname,
        url: blob.url,
        thumbUrl: blob.url.replace(`/${PHOTO_PREFIX}`, `/${THUMB_PREFIX}`),
        uploadedAt: blob.uploadedAt,
        year: match[1],
        month: match[2],
      });
    }
    if (!result.hasMore) break;
    cursor = result.cursor;
  }

  return photos.sort((a, b) => b.uploadedAt.getTime() - a.uploadedAt.getTime());
}

export function groupCounts<T extends string>(photos: Photo[], key: (p: Photo) => T) {
  const counts = new Map<T, { count: number; cover: Photo }>();
  for (const photo of photos) {
    const k = key(photo);
    const entry = counts.get(k);
    if (entry) entry.count += 1;
    else counts.set(k, { count: 1, cover: photo });
  }
  return counts;
}

/** Serves the site's 404 page with a real 404 status (rewrites to prerendered routes fail on Vercel). */
export async function notFoundResponse(origin: URL) {
  let body = "Not found";
  try {
    const res = await fetch(new URL("/404", origin));
    if (res.ok || res.status === 404) body = await res.text();
  } catch {
    // fall back to plain text
  }
  return new Response(body, { status: 404, headers: { "Content-Type": "text/html; charset=utf-8", "X-Robots-Tag": "noindex" } });
}
