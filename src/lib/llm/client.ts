/**
 * Groq client wrapper with exponential backoff and retry logic.
 *
 * Groq uses an OpenAI-compatible API at https://api.groq.com/openai/v1
 * so we use the `openai` SDK pointed at Groq's base URL.
 *
 * Models used:
 * - Planning/complex tasks: llama-3.3-70b-versatile
 * - Tool selection/review:  llama-3.1-8b-instant
 */

import OpenAI from "openai";

// ---------------------------------------------------------------------------
// Interface (compatible with existing agent code)
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

// Alias kept so existing imports don't break
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

  return (
    message.includes("503") ||
    message.includes("500") ||
    message.includes("unavailable") ||
    message.includes("internal server error") ||
    message.includes("rate_limit_exceeded")
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
      if (isLast || !isRetryableError(error)) break;
      await sleep(computeDelay(attempt));
    }
  }

  const totalAttempts = MAX_RETRIES + 1;
  throw new LLMError(
    `Groq API call failed after ${totalAttempts} attempt(s): ${
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
 * Creates a Groq client using Groq's OpenAI-compatible API.
 *
 * @param apiKey - Optional Groq API key. Falls back to `GROQ_API_KEY` env var.
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
            const resolvedKey =
              apiKey ??
              process.env.GROQ_API_KEY ??
              "";

            const client = new OpenAI({
              apiKey: resolvedKey,
              baseURL: "https://api.groq.com/openai/v1",
            });

            const userContent = parts.map((p) => p.text).join("\n\n");

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
              response: { text: () => content },
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
