/**
 * Property-based tests for `assembleFinalResult`.
 *
 * **Validates: assembly correctness property**
 */

import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { assembleFinalResult } from "../assembly";
import type { ExecutionResult } from "../../../types";

// ---------------------------------------------------------------------------
// Arbitraries
// ---------------------------------------------------------------------------

const executionResultArb: fc.Arbitrary<ExecutionResult> = fc.record({
  stepId: fc.string({ minLength: 1 }),
  toolUsed: fc.constantFrom("web_search", "web_scraper", "calculator"),
  input: fc.record({ query: fc.string() }),
  output: fc.jsonValue(),
  status: fc.constant("success" as const),
  logs: fc.array(fc.string()),
  confidence: fc.float({ min: 0, max: 1 }),
  createdAt: fc.constant(new Date("2024-01-01")),
});

/** Non-empty query strings (at least one non-whitespace character). */
const nonEmptyQueryArb = fc.string({ minLength: 1 }).filter((s) => s.trim().length > 0);

/** Arrays of 1–5 ExecutionResult objects. */
const stepResultsArb = fc.array(executionResultArb, { minLength: 1, maxLength: 5 });

// ---------------------------------------------------------------------------
// Properties
// ---------------------------------------------------------------------------

describe("assembleFinalResult — property-based tests", () => {
  it("determinism: same inputs always produce structurally equivalent outputs", () => {
    fc.assert(
      fc.property(nonEmptyQueryArb, stepResultsArb, (query, stepResults) => {
        const result1 = assembleFinalResult(query, stepResults);
        const result2 = assembleFinalResult(query, stepResults);

        // Same summary
        expect(result1.summary).toBe(result2.summary);

        // Same data keys
        const keys1 = Object.keys(result1.data as Record<string, unknown>).sort();
        const keys2 = Object.keys(result2.data as Record<string, unknown>).sort();
        expect(keys1).toEqual(keys2);

        // Same stepResults length
        expect(result1.stepResults.length).toBe(result2.stepResults.length);
      })
    );
  });

  it("summary non-empty: summary is always a non-empty string for valid inputs", () => {
    fc.assert(
      fc.property(nonEmptyQueryArb, stepResultsArb, (query, stepResults) => {
        const result = assembleFinalResult(query, stepResults);
        expect(typeof result.summary).toBe("string");
        expect(result.summary.length).toBeGreaterThan(0);
      })
    );
  });

  it("stepResults preserved: output.stepResults always equals the input stepResults array", () => {
    fc.assert(
      fc.property(nonEmptyQueryArb, stepResultsArb, (query, stepResults) => {
        const result = assembleFinalResult(query, stepResults);
        expect(result.stepResults).toBe(stepResults);
      })
    );
  });

  it("data keys match steps: output.data has keys step_1 … step_n matching the number of steps", () => {
    fc.assert(
      fc.property(nonEmptyQueryArb, stepResultsArb, (query, stepResults) => {
        const result = assembleFinalResult(query, stepResults);
        const data = result.data as Record<string, unknown>;
        const expectedKeys = stepResults.map((_, i) => `step_${i + 1}`);
        expect(Object.keys(data).sort()).toEqual(expectedKeys.sort());
      })
    );
  });

  // ---------------------------------------------------------------------------
  // Precondition guards
  // ---------------------------------------------------------------------------

  it("precondition: empty taskQuery throws an Error", () => {
    fc.assert(
      fc.property(stepResultsArb, (stepResults) => {
        expect(() => assembleFinalResult("", stepResults)).toThrow(Error);
      })
    );
  });

  it("precondition: empty stepResults throws an Error", () => {
    fc.assert(
      fc.property(nonEmptyQueryArb, (query) => {
        expect(() => assembleFinalResult(query, [])).toThrow(Error);
      })
    );
  });
});
