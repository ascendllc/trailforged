import type { APIRoute } from "astro";
import { getClaude } from "../../lib/claude";
import { CHIP_SYSTEM_PROMPT } from "../../lib/chipSystemPrompt";

export const prerender = false;

const MODEL = "claude-haiku-4-5-20251001";
const MAX_HISTORY = 20;
const MAX_MESSAGE_LENGTH = 2000;
const MAX_TOKENS = 1024;

const RATE_LIMIT = 20;
const RATE_WINDOW_MS = 60_000;
const rateLimits = new Map<string, { count: number; windowStart: number }>();

function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const entry = rateLimits.get(ip);
  if (!entry || now - entry.windowStart > RATE_WINDOW_MS) {
    rateLimits.set(ip, { count: 1, windowStart: now });
    return false;
  }
  entry.count += 1;
  return entry.count > RATE_LIMIT;
}

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

function isValidHistory(value: unknown): value is ChatMessage[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_HISTORY) return false;
  return value.every(
    (m) =>
      m &&
      typeof m === "object" &&
      (m.role === "user" || m.role === "assistant") &&
      typeof m.content === "string" &&
      m.content.length > 0 &&
      m.content.length <= MAX_MESSAGE_LENGTH
  );
}

export const POST: APIRoute = async ({ request, clientAddress }) => {
  let ip = "unknown";
  try {
    ip = clientAddress ?? "unknown";
  } catch {
    // clientAddress can throw in some runtimes when unavailable — fine to fall back.
  }

  if (isRateLimited(ip)) {
    return new Response(JSON.stringify({ error: "Too many messages — please wait a moment and try again." }), {
      status: 429,
      headers: { "Content-Type": "application/json" },
    });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid request body." }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const history = (body as { messages?: unknown })?.messages;
  if (!isValidHistory(history)) {
    return new Response(JSON.stringify({ error: "Invalid message history." }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const trimmedHistory = history.slice(-MAX_HISTORY);

  let claudeStream;
  try {
    claudeStream = getClaude().messages.stream({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system: CHIP_SYSTEM_PROMPT,
      messages: trimmedHistory.map((m) => ({ role: m.role, content: m.content })),
      tools: [
        {
          type: "web_search_20260318",
          name: "web_search",
          allowed_domains: ["traillifeusa.com"],
          max_uses: 3,
        },
      ],
    });
  } catch (error) {
    console.error("[chip] Failed to start Claude stream:", error);
    return new Response(JSON.stringify({ error: "Chip is unavailable right now — please try again shortly." }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  const encoder = new TextEncoder();
  const body_ = new ReadableStream({
    async start(controller) {
      claudeStream.on("text", (delta) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ delta })}\n\n`));
      });

      try {
        await claudeStream.done();
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      } catch (error) {
        console.error("[chip] Streaming error:", error);
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ error: "Something went wrong. Please try again." })}\n\n`)
        );
      } finally {
        controller.close();
      }
    },
  });

  return new Response(body_, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
};
