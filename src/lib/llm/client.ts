/**
 * Gemini client wrapper with exponential backoff and retry logic.
 *
 * Wraps `@google/generative-ai` SDK's `generateContent` with:
 * - Up to 3 retries on rate-limit (429) and server errors (5xx)
 * - Exponential backoff with jitter: delay = baseDelay * 2^attempt + jitter(0–200ms)
 * - Structured `LLMError` thrown when all retries are exhausted
 */

import { GoogleGenerativeAI } from "@google/generative-ai";
import type { IGeminiClient } from "../agents/executor/toolSelection";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_RETRIES = 3;
const BASE_DELAY_MS = 1000;
const MAX_JITTER_MS = 200;

// ---------------------------------------------------------------------------
// Error class
// ---------------------------------------------------------------------------

/**
 * Thrown when all retry attempts for a Gemini API call are exhausted.
 */
export class LLMError extends Error {
  /** Total number of attempts made (including the initial attempt). */
  attempts: number;
  /** The last error received from the Gemini API. */
  lastError: unknown;

  constructor(message: string, attempts: number, lastError: unknown) {
    super(message);
    this.name = "LLMError";
    this.attempts = attempts;
    this.lastError = lastError;

    // Restore prototype chain (required when extending built-ins in TypeScript).
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

// ---------------------------------------------------------------------------
// Retry helpers
// ---------------------------------------------------------------------------

/**
 * Returns true if the error is retryable (rate limit or server error).
 */
function isRetryableError(error: unknown): boolean {
  const message =
    error instanceof Error
      ? error.message.toLowerCase()
      : String(error).toLowerCase();

  return (
    message.includes("429") ||
    message.includes("quota") ||
    message.includes("rate") ||
    message.includes("503") ||
    message.includes("500") ||
    message.includes("unavailable")
  );
}

/**
 * Computes the delay for a given attempt using exponential backoff with jitter.
 *
 * delay = baseDelay * 2^attempt + jitter
 * where jitter is a random value in [0, MAX_JITTER_MS).
 *
 * @param attempt - Zero-based attempt index (0 = first retry).
 */
function computeDelay(attempt: number): number {
  const jitter = Math.random() * MAX_JITTER_MS;
  return BASE_DELAY_MS * Math.pow(2, attempt) + jitter;
}

/**
 * Sleeps for `ms` milliseconds.
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// Wrapped generateContent with retry
// ---------------------------------------------------------------------------

/**
 * Wraps a `generateContent` call with exponential backoff retry logic.
 *
 * @param fn      - The async function to call (should call `model.generateContent`).
 * @returns The result of `fn` on success.
 * @throws `LLMError` if all retries are exhausted.
 */
async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
  let lastError: unknown;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      const isLast = attempt === MAX_RETRIES;
      if (isLast || !isRetryableError(error)) {
        // Non-retryable error or final attempt — stop immediately
        break;
      }

      const delay = computeDelay(attempt);
      await sleep(delay);
    }
  }

  const totalAttempts = MAX_RETRIES + 1;
  throw new LLMError(
    `Gemini API call failed after ${totalAttempts} attempt(s): ${
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
 * Creates a Gemini client that wraps `@google/generative-ai` with retry logic.
 *
 * The returned object is compatible with the `IGeminiClient` interface used
 * throughout the codebase (PlannerAgent, selectTool, etc.).
 *
 * @param apiKey - Optional Gemini API key. Falls back to `GEMINI_API_KEY`
 *                 environment variable, then `GOOGLE_API_KEY`.
 */
export function createGeminiClient(apiKey?: string): IGeminiClient {
  const resolvedKey =
    apiKey ??
    process.env.GEMINI_API_KEY ??
    process.env.GOOGLE_API_KEY ??
    "";

  const sdk = new GoogleGenerativeAI(resolvedKey);

  return {
    getGenerativeModel(params: {
      model: string;
      generationConfig?: Record<string, unknown>;
    }) {
      const model = sdk.getGenerativeModel({
        model: params.model,
        generationConfig: params.generationConfig as
          | Record<string, unknown>
          | undefined,
      });

      return {
        async generateContent(
          parts: Array<{ text: string }>
        ): Promise<{ response: { text(): string } }> {
          return withRetry(() => model.generateContent(parts));
        },
      };
    },
  };
}

// ---------------------------------------------------------------------------
// Default singleton
// ---------------------------------------------------------------------------

/**
 * Default Gemini client singleton.
 * Uses `GEMINI_API_KEY` or `GOOGLE_API_KEY` from the environment.
 */
export const geminiClient = createGeminiClient();
