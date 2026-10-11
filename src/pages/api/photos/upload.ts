import type { APIRoute } from "astro";
import { createHash } from "node:crypto";
import { put, list, BlobError } from "@vercel/blob";
import { checkBotId } from "botid/server";
import sharp from "sharp";
import { PHOTO_PREFIX, THUMB_PREFIX, currentYearMonth } from "../../../lib/photos";

export const prerender = false;

const MAX_UPLOAD_BYTES = 4 * 1024 * 1024; // Vercel rejects request bodies over ~4.5MB
const MAX_INPUT_PIXELS = 80_000_000;
const FULL_EDGE = 2000;
const THUMB_EDGE = 480;

const IP_LIMIT = 40; // photos per IP per window
const IP_WINDOW_MS = 10 * 60_000;
const MONTHLY_CAP = 1500; // hard backstop on total photos stored per month

const ipHits = new Map<string, { count: number; windowStart: number }>();
const monthCache = new Map<string, { count: number; at: number }>();

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

function ipLimited(ip: string) {
  const now = Date.now();
  const entry = ipHits.get(ip);
  if (!entry || now - entry.windowStart > IP_WINDOW_MS) {
    ipHits.set(ip, { count: 1, windowStart: now });
    return false;
  }
  entry.count += 1;
  return entry.count > IP_LIMIT;
}

async function monthCount(year: string, month: string) {
  const key = `${year}/${month}`;
  const cached = monthCache.get(key);
  if (cached && Date.now() - cached.at < 30_000) return cached.count;

  let count = 0;
  let cursor: string | undefined;
  for (let page = 0; page < 5; page++) {
    const result = await list({ prefix: `${PHOTO_PREFIX}${key}/`, limit: 1000, cursor });
    count += result.blobs.length;
    if (!result.hasMore) break;
    cursor = result.cursor;
  }
  monthCache.set(key, { count, at: Date.now() });
  return count;
}

// Only real raster photos get through; SVG, HTML, scripts, etc. fail here.
function looksLikeImage(buf: Buffer) {
  const jpeg = buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
  const png = buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  const webp = buf.subarray(0, 4).toString("ascii") === "RIFF" && buf.subarray(8, 12).toString("ascii") === "WEBP";
  return jpeg || png || webp;
}

export const POST: APIRoute = async ({ request, clientAddress }) => {
  const verification = await checkBotId();
  if (verification.isBot) {
    return json({ error: "Access denied." }, 403);
  }

  let ip = "unknown";
  try {
    ip = clientAddress ?? "unknown";
  } catch {
    // clientAddress can be unavailable in some runtimes.
  }
  if (ipLimited(ip)) {
    return json({ error: "You're uploading a lot of photos — please wait a few minutes and try again." }, 429);
  }

  const declaredLength = Number(request.headers.get("content-length") ?? 0);
  if (declaredLength > MAX_UPLOAD_BYTES + 64 * 1024) {
    return json({ error: "That photo is too large." }, 413);
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return json({ error: "Invalid upload." }, 400);
  }

  // Hidden field real people never fill in; bots that auto-fill every input do.
  if (String(form.get("website") ?? "") !== "") {
    return json({ error: "Access denied." }, 403);
  }
  if (form.get("consent") !== "yes") {
    return json({ error: "Please confirm you personally took these photos." }, 400);
  }

  const file = form.get("photo");
  if (!(file instanceof File) || file.size === 0 || file.size > MAX_UPLOAD_BYTES) {
    return json({ error: "That photo is missing or too large." }, 400);
  }

  const input = Buffer.from(await file.arrayBuffer());
  if (!looksLikeImage(input)) {
    return json({ error: "That file isn't a supported photo (use JPG, PNG, or WebP)." }, 415);
  }

  let full: Buffer;
  let thumb: Buffer;
  try {
    const image = sharp(input, { limitInputPixels: MAX_INPUT_PIXELS, failOn: "error" }).rotate();
    full = await image
      .clone()
      .resize({ width: FULL_EDGE, height: FULL_EDGE, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 82, mozjpeg: true })
      .toBuffer();
    thumb = await image
      .clone()
      .resize({ width: THUMB_EDGE, height: THUMB_EDGE, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 75, mozjpeg: true })
      .toBuffer();
  } catch {
    return json({ error: "We couldn't read that photo. Try a different file." }, 415);
  }

  const { year, month } = currentYearMonth();
  if ((await monthCount(year, month)) >= MONTHLY_CAP) {
    return json({ error: "We've reached this month's upload limit. Please try again next month." }, 503);
  }

  const id = createHash("sha256").update(full).digest("base64url").slice(0, 16);
  const fullPath = `${PHOTO_PREFIX}${year}/${month}/${id}.jpg`;
  const thumbPath = `${THUMB_PREFIX}${year}/${month}/${id}.jpg`;

  try {
    await put(thumbPath, thumb, {
      access: "private",
      contentType: "image/jpeg",
      addRandomSuffix: false,
      allowOverwrite: true,
    });
    await put(fullPath, full, {
      access: "private",
      contentType: "image/jpeg",
      addRandomSuffix: false,
      allowOverwrite: false,
    });
  } catch (error) {
    // The identical photo was already uploaded this month — treat as success.
    if (error instanceof BlobError && /already exists/i.test(error.message)) {
      return json({ ok: true, duplicate: true });
    }
    console.error("[photos] upload failed:", error);
    return json({ error: "Something went wrong saving that photo. Please try again." }, 500);
  }

  const cached = monthCache.get(`${year}/${month}`);
  if (cached) cached.count += 1;

  return json({ ok: true });
};
