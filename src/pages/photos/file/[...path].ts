import type { APIRoute } from "astro";
import { get } from "@vercel/blob";

export const prerender = false;

const FILE_PATTERN = /^(photos|thumbs)\/\d{4}\/(0[1-9]|1[0-2])\/[A-Za-z0-9_-]{16}\.jpg$/;

// Photos live in a private Blob store, so this is the only way to reach the image files.
// It sits under /photos, so the password gate in middleware.ts protects it.
export const GET: APIRoute = async ({ params, request }) => {
  const path = params.path ?? "";
  if (!FILE_PATTERN.test(path)) return new Response("Not found", { status: 404 });

  try {
    const result = await get(path, {
      access: "private",
      ifNoneMatch: request.headers.get("if-none-match") ?? undefined,
    });
    if (!result) return new Response("Not found", { status: 404 });

    const headers = {
      "Content-Type": "image/jpeg",
      "Cache-Control": "private, max-age=86400",
      "X-Content-Type-Options": "nosniff",
      "X-Robots-Tag": "noindex, nofollow",
      ETag: result.blob.etag,
    };
    if (result.statusCode === 304) return new Response(null, { status: 304, headers });
    return new Response(result.stream, { headers });
  } catch (error) {
    console.error("[photos] could not read file:", error);
    return new Response("Not found", { status: 404 });
  }
};
