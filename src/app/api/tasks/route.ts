import { NextRequest } from "next/server";
import { z } from "zod";
import { connectDB } from "@/lib/db";
import Task from "@/lib/models/Task";
import { orchestrator } from "@/lib/container";

// ---------------------------------------------------------------------------
// Rate limiting — in-memory Map: IP → { count, windowStart }
// ---------------------------------------------------------------------------

interface RateLimitEntry {
  count: number;
  windowStart: number;
}

const rateLimitMap = new Map<string, RateLimitEntry>();
const RATE_LIMIT_MAX = 10;
const RATE_LIMIT_WINDOW_MS = 60_000; // 1 minute

function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const entry = rateLimitMap.get(ip);

  if (!entry || now - entry.windowStart > RATE_LIMIT_WINDOW_MS) {
    rateLimitMap.set(ip, { count: 1, windowStart: now });
    return true;
  }

  if (entry.count >= RATE_LIMIT_MAX) {
    return false;
  }

  entry.count += 1;
  return true;
}

// ---------------------------------------------------------------------------
// Input sanitization — strip HTML tags and trim whitespace
// ---------------------------------------------------------------------------

function sanitizeQuery(input: string): string {
  // Strip HTML tags to prevent prompt injection via markup
  return input.replace(/<[^>]*>/g, "").trim();
}

// ---------------------------------------------------------------------------
// Zod schema
// ---------------------------------------------------------------------------

const PostTaskSchema = z.object({
  userQuery: z
    .string()
    .min(1, "userQuery must not be empty")
    .max(2000, "userQuery must not exceed 2000 characters"),
});

// ---------------------------------------------------------------------------
// POST /api/tasks
// ---------------------------------------------------------------------------

export async function POST(request: NextRequest) {
  // --- Auth check ---
  if (process.env.AUTH_DISABLED !== "true") {
    const authHeader = request.headers.get("authorization") ?? "";
    const token = authHeader.startsWith("Bearer ")
      ? authHeader.slice(7).trim()
      : "";
    if (!token) {
      return Response.json(
        { error: "Unauthorized: missing or invalid Bearer token" },
        { status: 401 }
      );
    }
  }

  // --- Rate limiting ---
  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0].trim() ??
    "unknown";
  if (!checkRateLimit(ip)) {
    return Response.json(
      { error: "Too many requests. Please try again later." },
      { status: 429 }
    );
  }

  // --- Parse and validate body ---
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = PostTaskSchema.safeParse(body);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => i.message).join("; ");
    return Response.json({ error: issues }, { status: 400 });
  }

  // --- Sanitize ---
  const sanitizedQuery = sanitizeQuery(parsed.data.userQuery);
  if (!sanitizedQuery) {
    return Response.json(
      { error: "userQuery must not be empty after sanitization" },
      { status: 400 }
    );
  }

  // --- Persist task ---
  await connectDB();
  const task = await Task.create({
    userQuery: sanitizedQuery,
    status: "pending",
  });
  const taskId = task._id.toString();

  // --- Fire-and-forget orchestration ---
  if (orchestrator) {
    orchestrator.startTask(taskId, sanitizedQuery).catch((err: unknown) => {
      console.error(`[orchestrator] startTask failed for ${taskId}:`, err);
    });
  }

  return Response.json({ taskId }, { status: 200 });
}
