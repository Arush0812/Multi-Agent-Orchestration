/**
 * ReviewerAgent — validates an execution result against the step's expected
 * output schema and the original task goal, then returns a ReviewDecision.
 *
 * Responsibilities:
 * - Immediately reject results with status "failure"
 * - Validate result.output against step.expectedOutputSchema using zod
 * - Call Gemini gemini-1.5-flash to assess relevance to the task query
 * - Parse and validate the ReviewDecision from the JSON response
 * - Ensure decision is exactly "accept" or "reject", never undefined
 * - Clamp confidence to [0, 1]
 * - On any Gemini error: return a reject decision with the error message
 */

import { z } from "zod";
import type { ReviewDecision, JSONSchema, ExecutionResult } from "../../../types";
import type { IGeminiClient } from "../executor/toolSelection";

// ---------------------------------------------------------------------------
// Minimal step interface for review (avoids coupling to Mongoose Document)
// ---------------------------------------------------------------------------

export interface IStepForReview {
  description: string;
  expectedOutputSchema: JSONSchema;
}

// ---------------------------------------------------------------------------
// ReviewerAgent interface
// ---------------------------------------------------------------------------

export interface IReviewerAgent {
  review(
    step: IStepForReview,
    result: ExecutionResult,
    taskQuery: string
  ): Promise<ReviewDecision>;
}

// ---------------------------------------------------------------------------
// Zod schema for the Gemini response
// ---------------------------------------------------------------------------

const GeminiReviewResponseSchema = z.object({
  decision: z.enum(["accept", "reject"]),
  reason: z.string(),
  suggestions: z.array(z.string()).optional(),
  confidence: z.number(),
});

// ---------------------------------------------------------------------------
// Helper: build the review prompt
// ---------------------------------------------------------------------------

function buildReviewPrompt(
  step: IStepForReview,
  result: ExecutionResult,
  taskQuery: string
): string {
  return [
    "You are a quality reviewer for an AI task automation system.",
    "Your job is to assess whether an execution result meets the requirements of a step and is relevant to the overall task.",
    "",
    `Overall task query: ${taskQuery}`,
    "",
    `Step description: ${step.description}`,
    "",
    "Expected output schema:",
    JSON.stringify(step.expectedOutputSchema, null, 2),
    "",
    "Actual output:",
    JSON.stringify(result.output, null, 2),
    "",
    "Assess the result and respond with a JSON object in the following format:",
    '{',
    '  "decision": "accept" | "reject",',
    '  "reason": "<explanation of your decision>",',
    '  "suggestions": ["<optional improvement suggestion>"],',
    '  "confidence": <number between 0 and 1>',
    '}',
    "",
    "Accept if the output is relevant to the task, matches the expected schema structure, and provides useful information.",
    "Reject if the output is missing, irrelevant, malformed, or does not address the step description.",
    "The suggestions field is optional — only include it when rejecting with actionable improvement hints.",
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Helper: build a zod schema from a JSONSchema object (best-effort)
// ---------------------------------------------------------------------------

function buildZodSchemaFromJSONSchema(jsonSchema: JSONSchema): z.ZodTypeAny {
  const type = jsonSchema["type"];

  if (type === "object") {
    const properties = jsonSchema["properties"] as Record<string, JSONSchema> | undefined;
    if (properties) {
      const shape: Record<string, z.ZodTypeAny> = {};
      for (const [key, propSchema] of Object.entries(properties)) {
        shape[key] = buildZodSchemaFromJSONSchema(propSchema).optional();
      }
      return z.object(shape).passthrough();
    }
    return z.record(z.unknown());
  }

  if (type === "array") {
    const items = jsonSchema["items"] as JSONSchema | undefined;
    if (items) {
      return z.array(buildZodSchemaFromJSONSchema(items));
    }
    return z.array(z.unknown());
  }

  if (type === "string") return z.string();
  if (type === "number") return z.number();
  if (type === "boolean") return z.boolean();
  if (type === "null") return z.null();

  // Unknown or complex schema — accept any value
  return z.unknown();
}

// ---------------------------------------------------------------------------
// ReviewerAgent implementation
// ---------------------------------------------------------------------------

export class ReviewerAgent implements IReviewerAgent {
  constructor(private readonly gemini: IGeminiClient) {}

  /**
   * Review an execution result for a given step.
   *
   * @param step      - The step being reviewed (description + expectedOutputSchema).
   * @param result    - The execution result to validate.
   * @param taskQuery - The original high-level task query for relevance assessment.
   *
   * @returns A ReviewDecision. Never throws.
   */
  async review(
    step: IStepForReview,
    result: ExecutionResult,
    taskQuery: string
  ): Promise<ReviewDecision> {
    // Step 1: Immediately reject failed executions
    if (result.status === "failure") {
      const lastLog =
        result.logs.length > 0
          ? result.logs[result.logs.length - 1]
          : "No logs available";
      return {
        decision: "reject",
        reason: `Execution failed: ${lastLog}`,
        confidence: 0,
      };
    }

    // Step 2: Validate output against expectedOutputSchema using zod
    if (result.output === null || result.output === undefined) {
      return {
        decision: "reject",
        reason: "Execution produced no output (null or undefined)",
        confidence: 0,
      };
    }

    try {
      const zodSchema = buildZodSchemaFromJSONSchema(step.expectedOutputSchema);
      const parseResult = zodSchema.safeParse(result.output);
      if (!parseResult.success) {
        return {
          decision: "reject",
          reason: `Output does not match expected schema: ${parseResult.error.message}`,
          confidence: 0,
        };
      }
    } catch {
      // If schema building itself fails, skip structural validation and
      // let Gemini assess the output on its own.
    }

    // Step 3: Call Gemini to assess relevance and quality
    try {
      const prompt = buildReviewPrompt(step, result, taskQuery);

      const model = this.gemini.getGenerativeModel({
        model: "gemini-1.5-flash",
        generationConfig: {
          responseMimeType: "application/json",
        },
      });

      const geminiResult = await model.generateContent([{ text: prompt }]);
      const text = geminiResult.response.text();

      // Step 4: Parse the JSON response
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        return {
          decision: "reject",
          reason: `Failed to parse Gemini review response as JSON. Raw: ${text.slice(0, 200)}`,
          confidence: 0,
        };
      }

      // Step 5: Validate the parsed response shape
      const validated = GeminiReviewResponseSchema.safeParse(parsed);

      let decision: "accept" | "reject";
      let reason: string;
      let suggestions: string[] | undefined;
      let confidence: number;

      if (validated.success) {
        decision = validated.data.decision;
        reason = validated.data.reason;
        suggestions = validated.data.suggestions;
        confidence = validated.data.confidence;
      } else {
        // Attempt partial extraction with fallback defaults
        const raw = parsed as Record<string, unknown>;

        // Step 6: Validate decision is exactly "accept" or "reject"
        const rawDecision = raw["decision"];
        if (rawDecision === "accept" || rawDecision === "reject") {
          decision = rawDecision;
        } else {
          decision = "reject";
        }

        reason =
          typeof raw["reason"] === "string"
            ? raw["reason"]
            : "Review response was malformed";

        const rawSuggestions = raw["suggestions"];
        if (
          Array.isArray(rawSuggestions) &&
          rawSuggestions.every((s) => typeof s === "string")
        ) {
          suggestions = rawSuggestions as string[];
        }

        const rawConfidence = raw["confidence"];
        confidence = typeof rawConfidence === "number" ? rawConfidence : 0;
      }

      // Step 7: Clamp confidence to [0, 1]
      confidence = Math.max(0, Math.min(1, confidence));

      // Step 8: Return the ReviewDecision
      const reviewDecision: ReviewDecision = {
        decision,
        reason,
        confidence,
      };
      if (suggestions !== undefined) {
        reviewDecision.suggestions = suggestions;
      }
      return reviewDecision;
    } catch (err) {
      // Step 9: On any Gemini error, return a reject decision
      const errorMessage =
        err instanceof Error ? err.message : String(err);
      return {
        decision: "reject",
        reason: `Review failed: ${errorMessage}`,
        confidence: 0,
      };
    }
  }
}
