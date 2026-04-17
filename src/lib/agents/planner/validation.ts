/**
 * Validation and normalization for the Planner agent's LLM response.
 *
 * Parses a raw JSON object from the LLM into a validated, sorted `PlannedStep[]`.
 * Throws `PlanValidationError` for any structural or semantic validation failure.
 */

import { z } from "zod";
import { PlannedStep, PlanValidationError } from "../../../types";

// ---------------------------------------------------------------------------
// Zod schema for a single planned step
// ---------------------------------------------------------------------------

const PlannedStepSchema = z.object({
  order: z
    .number({ invalid_type_error: "Step 'order' must be a number" })
    .int("Step 'order' must be an integer")
    .positive("Step 'order' must be a positive integer"),
  description: z
    .string({ invalid_type_error: "Step 'description' must be a string" })
    .min(1, "Step 'description' must be a non-empty string"),
  suggestedTool: z
    .enum(["web_search", "web_scraper", "calculator"])
    .nullable(),
  expectedOutputSchema: z
    .record(z.string(), z.unknown())
    .refine((v) => typeof v === "object" && v !== null, {
      message: "Step 'expectedOutputSchema' must be an object",
    }),
});

// Schema for the top-level LLM response envelope
const RawPlanSchema = z.object({
  steps: z.array(z.unknown(), {
    invalid_type_error: "'steps' must be an array",
    required_error: "Response must contain a 'steps' array",
  }),
});

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Validates and normalises a raw LLM JSON response into an ordered `PlannedStep[]`.
 *
 * @param raw - Parsed JSON object from the LLM (e.g. `{ steps: [...] }`)
 * @returns Validated `PlannedStep[]` sorted by `order` ascending (1, 2, 3, …)
 * @throws {PlanValidationError} If the response is missing required fields,
 *   contains malformed step data, has duplicate order values, or does not form
 *   a contiguous sequence starting at 1.
 */
export function validateAndNormalizePlan(raw: unknown): PlannedStep[] {
  // 1. Validate the top-level envelope
  const envelopeResult = RawPlanSchema.safeParse(raw);
  if (!envelopeResult.success) {
    const message = envelopeResult.error.errors
      .map((e) => e.message)
      .join("; ");
    throw new PlanValidationError(
      `Invalid plan response: ${message}`,
      raw
    );
  }

  const { steps: rawSteps } = envelopeResult.data;

  if (rawSteps.length === 0) {
    throw new PlanValidationError(
      "Invalid plan response: 'steps' array must not be empty",
      raw
    );
  }

  // 2. Validate each step individually
  const validatedSteps: PlannedStep[] = [];

  for (let i = 0; i < rawSteps.length; i++) {
    const stepResult = PlannedStepSchema.safeParse(rawSteps[i]);
    if (!stepResult.success) {
      const message = stepResult.error.errors.map((e) => e.message).join("; ");
      throw new PlanValidationError(
        `Invalid step at index ${i}: ${message}`,
        raw
      );
    }
    validatedSteps.push(stepResult.data as PlannedStep);
  }

  // 3. Sort by order ascending
  validatedSteps.sort((a, b) => a.order - b.order);

  // 4. Assert unique order values (no duplicates)
  const orderValues = validatedSteps.map((s) => s.order);
  const uniqueOrders = new Set(orderValues);
  if (uniqueOrders.size !== orderValues.length) {
    const duplicates = orderValues.filter(
      (v, idx) => orderValues.indexOf(v) !== idx
    );
    throw new PlanValidationError(
      `Invalid plan response: duplicate step order values found: ${[...new Set(duplicates)].join(", ")}`,
      raw
    );
  }

  // 5. Assert contiguous sequence starting at 1
  for (let i = 0; i < validatedSteps.length; i++) {
    const expected = i + 1;
    if (validatedSteps[i].order !== expected) {
      throw new PlanValidationError(
        `Invalid plan response: step orders must form a contiguous sequence starting at 1, but got order ${validatedSteps[i].order} at position ${i + 1}`,
        raw
      );
    }
  }

  return validatedSteps;
}
