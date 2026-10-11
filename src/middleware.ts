import { defineMiddleware } from "astro:middleware";
import { createHash, timingSafeEqual } from "node:crypto";

const REALM = "Troop 337 Photos";
const MAX_FAILURES = 10;
const FAILURE_WINDOW_MS = 10 * 60_000;
const failures = new Map<string, { count: number; windowStart: number }>();

const digest = (value: string) => createHash("sha256").update(value).digest();
const safeEqual = (a: string, b: string) => timingSafeEqual(digest(a), digest(b));

function isProtected(pathname: string) {
  return pathname === "/photos" || pathname.startsWith("/photos/");
}

function challenge(status: 401 | 429 | 503, message: string) {
  const headers: Record<string, string> = {
    "Content-Type": "text/plain; charset=utf-8",
    "Cache-Control": "private, no-store",
    "X-Robots-Tag": "noindex, nofollow",
  };
  if (status === 401) headers["WWW-Authenticate"] = `Basic realm="${REALM}", charset="UTF-8"`;
  return new Response(message, { status, headers });
}

export const onRequest = defineMiddleware(async (context, next) => {
  if (!isProtected(context.url.pathname)) return next();

  // Read at request time (not build time) so the credentials never end up in the bundle.
  const expectedUser = process.env.PHOTOS_USERNAME;
  const expectedPass = process.env.PHOTOS_PASSWORD;
  if (!expectedUser || !expectedPass) {
    return challenge(503, "The photo gallery isn't available right now.");
  }

  let ip = "unknown";
  try {
    ip = context.clientAddress ?? "unknown";
  } catch {
    // clientAddress can be unavailable in some runtimes.
  }

  const now = Date.now();
  const record = failures.get(ip);
  if (record && now - record.windowStart <= FAILURE_WINDOW_MS && record.count >= MAX_FAILURES) {
    return challenge(429, "Too many incorrect attempts. Please wait a few minutes and try again.");
  }

  const header = context.request.headers.get("authorization") ?? "";
  let authorized = false;
  if (header.startsWith("Basic ")) {
    try {
      const decoded = Buffer.from(header.slice(6), "base64").toString("utf8");
      const split = decoded.indexOf(":");
      if (split >= 0) {
        const userOk = safeEqual(decoded.slice(0, split), expectedUser);
        const passOk = safeEqual(decoded.slice(split + 1), expectedPass);
        authorized = userOk && passOk;
      }
    } catch {
      authorized = false;
    }
  }

  if (!authorized) {
    if (header) {
      const current = record && now - record.windowStart <= FAILURE_WINDOW_MS ? record : { count: 0, windowStart: now };
      current.count += 1;
      failures.set(ip, current);
    }
    return challenge(401, "Password required.");
  }

  failures.delete(ip);
  const response = await next();
  // Never let the CDN cache an authenticated page and serve it to someone who hasn't logged in.
  // Responses that already opted into private (browser-only) caching, like image files, keep it.
  if (!/private/i.test(response.headers.get("Cache-Control") ?? "")) {
    response.headers.set("Cache-Control", "private, no-store");
  }
  return response;
});
