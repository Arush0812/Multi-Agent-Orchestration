/**
 * Grok (xAI) client wrapper with exponential backoff and retry logic.
 *
 * Grok uses an OpenAI-compatible API, so we use the `openai` SDK
 * pointed at xAI's base URL: https://api.x.ai/v1
 *
 * Wraps `chat.completions.create` with:
 * - Up to 3 retries on server errors (5xx)
 * - Exponential backoff with jitter
 * - Structured `LLMError` thrown when all retries are exhausted
 */

import OpenAI from "openai";

// ---------------------------------------------------------------------------
// IGeminiClient-compatible interface (kept for backward compat with agents)
// We keep the same interface shape so no agent code needs to change.
// ---------------------------------------------------------------------------

export interface IGrokClient {
  getGenerativeModel(params: {
    model: string;
    generationConfig?: Record<string, unknown>;
  }): {
    generateContent(
      parts: Array<{ text: string }>
    ): Promise<{ response: { text(): string } }>;
  };
}

// Re-export as IGeminiClient alias so existing imports still work
export type IGeminiClient = IGrokClient;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_RETRIES = 3;
const BASE_DELAY_MS = 1000;
const MAX_JITTER_MS = 200;

// ---------------------------------------------------------------------------
// Error class
// ---------------------------------------------------------------------------

export class LLMError extends Error {
  attempts: number;
  lastError: unknown;

  constructor(message: string, attempts: number, lastError: unknown) {
    super(message);
    this.name = "LLMError";
    this.attempts = attempts;
    this.lastError = lastError;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

// ---------------------------------------------------------------------------
// Retry helpers
// ---------------------------------------------------------------------------

function isRetryableError(error: unknown): boolean {
  const message =
    error instanceof Error
      ? error.message.toLowerCase()
      : String(error).toLowerCase();

  // Retry on server errors only — not quota/auth errors
  return (
    message.includes("503") ||
    message.includes("500") ||
    message.includes("unavailable") ||
    message.includes("internal server error")
  );
}

function computeDelay(attempt: number): number {
  const jitter = Math.random() * MAX_JITTER_MS;
  return BASE_DELAY_MS * Math.pow(2, attempt) + jitter;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
  let lastError: unknown;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      const isLast = attempt === MAX_RETRIES;
      if (isLast || !isRetryableError(error)) {
        break;
      }

      const delay = computeDelay(attempt);
      await sleep(delay);
    }
  }

  const totalAttempts = MAX_RETRIES + 1;
  throw new LLMError(
    `Grok API call failed after ${totalAttempts} attempt(s): ${
      lastError instanceof Error ? lastError.message : String(lastError)
    }`,
    totalAttempts,
    lastError
  );
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Creates a Grok client using xAI's OpenAI-compatible API.
 *
 * The returned object matches the `IGrokClient` interface used throughout
 * the codebase (PlannerAgent, selectTool, ReviewerAgent, etc.).
 *
 * @param apiKey - Optional Grok API key. Falls back to `GROK_API_KEY` env var.
 */
export function createGeminiClient(apiKey?: string): IGrokClient {
  return {
    getGenerativeModel(params: {
      model: string;
      generationConfig?: Record<string, unknown>;
    }) {
      return {
        async generateContent(
          parts: Array<{ text: string }>
        ): Promise<{ response: { text(): string } }> {
          return withRetry(async () => {
            // Read key lazily so .env.local is loaded before we access it
            const resolvedKey =
              apiKey ??
              process.env.GROK_API_KEY ??
              "";

            const client = new OpenAI({
              apiKey: resolvedKey,
              baseURL: "https://api.x.ai/v1",
            });

            // Combine all parts into a single user message
            const userContent = parts.map((p) => p.text).join("\n\n");

            // Check if JSON mode is requested
            const wantsJson =
              params.generationConfig?.responseMimeType === "application/json";

            const response = await client.chat.completions.create({
              model: params.model,
              messages: [{ role: "user", content: userContent }],
              ...(wantsJson
                ? { response_format: { type: "json_object" } }
                : {}),
            });

            const content = response.choices[0]?.message?.content ?? "";

            return {
              response: {
                text: () => content,
              },
            };
          });
        },
      };
    },
  };
}

// ---------------------------------------------------------------------------
// Default singleton
// ---------------------------------------------------------------------------

export const geminiClient = createGeminiClient();
