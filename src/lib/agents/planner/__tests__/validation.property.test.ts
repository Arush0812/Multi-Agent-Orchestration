/**
 * Property-based tests for `validateAndNormalizePlan`.
 *
 * **Validates: planner correctness property** — `validateAndNormalizePlan(raw)`
 * always returns steps with unique, sequential order values [1, 2, …, n]
 * for any valid input shape, regardless of the input order.
 *
 * Uses `fast-check` for property generation and `vitest` as the test runner.
 */

import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { validateAndNormalizePlan } from "../validation";
import { PlanValidationError } from "../../../../types";

// ---------------------------------------------------------------------------
// Arbitraries
// ---------------------------------------------------------------------------

/**
 * Generates a single valid step object with arbitrary (but valid) field values.
 * The `order` value is intentionally unconstrained here so callers can
 * compose it with uniqueness / sequencing constraints as needed.
 */
const stepArb = fc.record({
  order: fc.integer({ min: 1, max: 20 }),
  description: fc.string({ minLength: 1 }),
  suggestedTool: fc.constantFrom(
    "web_search" as const,
    "web_scraper" as const,
    "calculator" as const,
    null
  ),
  expectedOutputSchema: fc.constant({ type: "object" }),
});

/**
 * Generates an array of steps whose `order` values form a contiguous sequence
 * [1, 2, …, n] but are presented in a *shuffled* (random) order.
 *
 * Strategy:
 *  1. Pick a length n in [1, 10].
 *  2. Generate n step "bodies" (everything except `order`).
 *  3. Assign orders 1..n to the bodies.
 *  4. Shuffle the resulting array.
 */
const shuffledSequentialStepsArb = fc
  .integer({ min: 1, max: 10 })
  .chain((n) =>
    fc
      .array(
        fc.record({
          description: fc.string({ minLength: 1 }),
          suggestedTool: fc.constantFrom(
            "web_search" as const,
            "web_scraper" as const,
            "calculator" as const,
            null
          ),
          expectedOutputSchema: fc.constant({ type: "object" }),
        }),
        { minLength: n, maxLength: n }
      )
      .map((bodies) => {
        // Assign sequential orders 1..n
        const ordered = bodies.map((body, idx) => ({
          ...body,
          order: idx + 1,
        }));
        // Shuffle using Fisher-Yates via sort with random comparator
        // fast-check controls randomness, so we use a deterministic shuffle
        // based on the generated index permutation.
        return ordered;
      })
      .chain((ordered) =>
        fc.shuffledSubarray(ordered, {
          minLength: ordered.length,
          maxLength: ordered.length,
        })
      )
  );

// ---------------------------------------------------------------------------
// Property 1: Main property — output always has sequential orders [1..n]
// ---------------------------------------------------------------------------

describe("validateAndNormalizePlan — sequential step ordering (property-based)", () => {
  /**
   * **Validates: planner correctness property**
   *
   * For any valid input with steps whose orders form a contiguous sequence
   * starting at 1 (possibly shuffled), `validateAndNormalizePlan` must return
   * steps with orders exactly [1, 2, 3, …, n].
   */
  it("always returns steps with orders [1, 2, …, n] for any valid shuffled input", () => {
    fc.assert(
      fc.property(shuffledSequentialStepsArb, (steps) => {
        const raw = { steps };
        const result = validateAndNormalizePlan(raw);

        // Orders must be exactly [1, 2, ..., n]
        const expectedOrders = Array.from(
          { length: result.length },
          (_, i) => i + 1
        );
        const actualOrders = result.map((s) => s.order);

        expect(actualOrders).toEqual(expectedOrders);
      }),
      { numRuns: 200 }
    );
  });

  /**
   * **Validates: planner correctness property**
   *
   * For any valid input, the returned steps must have *unique* order values
   * (no duplicates).
   */
  it("always returns steps with unique order values for any valid shuffled input", () => {
    fc.assert(
      fc.property(shuffledSequentialStepsArb, (steps) => {
        const raw = { steps };
        const result = validateAndNormalizePlan(raw);

        const orders = result.map((s) => s.order);
        const uniqueOrders = new Set(orders);

        expect(uniqueOrders.size).toBe(orders.length);
      }),
      { numRuns: 200 }
    );
  });

  // ---------------------------------------------------------------------------
  // Property 2: Ordering property — output is always sorted ascending by order
  // ---------------------------------------------------------------------------

  /**
   * **Validates: planner correctness property**
   *
   * For any valid plan input with sequential orders, the returned steps are
   * always sorted ascending by `order`.
   */
  it("always returns steps sorted ascending by order for any valid sequential input", () => {
    fc.assert(
      fc.property(shuffledSequentialStepsArb, (steps) => {
        const raw = { steps };
        const result = validateAndNormalizePlan(raw);

        for (let i = 1; i < result.length; i++) {
          expect(result[i].order).toBeGreaterThan(result[i - 1].order);
        }
      }),
      { numRuns: 200 }
    );
  });

  // ---------------------------------------------------------------------------
  // Property 3: Round-trip property — result is independent of input order
  // ---------------------------------------------------------------------------

  /**
   * **Validates: planner correctness property**
   *
   * A valid plan with steps in any order always produces the same result
   * regardless of input order (i.e., the function is order-agnostic).
   *
   * We verify this by running the function on the same steps in two different
   * orderings and asserting the outputs are identical.
   */
  it("produces the same result regardless of input step order (round-trip)", () => {
    fc.assert(
      fc.property(shuffledSequentialStepsArb, (steps) => {
        // Create a reversed ordering of the same steps
        const reversed = [...steps].reverse();

        const resultForward = validateAndNormalizePlan({ steps });
        const resultReversed = validateAndNormalizePlan({ steps: reversed });

        expect(resultForward).toEqual(resultReversed);
      }),
      { numRuns: 200 }
    );
  });

  // ---------------------------------------------------------------------------
  // Property: Invalid inputs throw PlanValidationError
  // ---------------------------------------------------------------------------

  /**
   * **Validates: planner correctness property**
   *
   * For inputs with duplicate order values, `validateAndNormalizePlan` must
   * throw `PlanValidationError`.
   */
  it("throws PlanValidationError for steps with duplicate order values", () => {
    fc.assert(
      fc.property(
        // Generate at least 2 steps that share the same order value
        fc
          .integer({ min: 2, max: 8 })
          .chain((n) =>
            fc.array(
              fc.record({
                order: fc.integer({ min: 1, max: 3 }), // small range → high collision probability
                description: fc.string({ minLength: 1 }),
                suggestedTool: fc.constantFrom(
                  "web_search" as const,
                  "web_scraper" as const,
                  "calculator" as const,
                  null
                ),
                expectedOutputSchema: fc.constant({ type: "object" }),
              }),
              { minLength: n, maxLength: n }
            )
          )
          .filter((steps) => {
            // Keep only inputs that actually have duplicates
            const orders = steps.map((s) => s.order);
            return new Set(orders).size < orders.length;
          }),
        (steps) => {
          expect(() => validateAndNormalizePlan({ steps })).toThrow(
            PlanValidationError
          );
        }
      ),
      { numRuns: 200 }
    );
  });

  /**
   * **Validates: planner correctness property**
   *
   * For inputs with non-contiguous order values (gaps), `validateAndNormalizePlan`
   * must throw `PlanValidationError`.
   */
  it("throws PlanValidationError for steps with non-contiguous order values", () => {
    fc.assert(
      fc.property(
        // Generate steps with unique but non-contiguous orders (e.g. [1, 3, 4])
        fc
          .integer({ min: 2, max: 8 })
          .chain((n) =>
            fc
              .uniqueArray(fc.integer({ min: 1, max: 30 }), {
                minLength: n,
                maxLength: n,
              })
              .filter((orders) => {
                // Ensure the orders are NOT already a contiguous sequence from 1
                const sorted = [...orders].sort((a, b) => a - b);
                return !(
                  sorted[0] === 1 &&
                  sorted.every((v, i) => v === i + 1)
                );
              })
              .chain((orders) =>
                fc
                  .array(
                    fc.record({
                      description: fc.string({ minLength: 1 }),
                      suggestedTool: fc.constantFrom(
                        "web_search" as const,
                        "web_scraper" as const,
                        "calculator" as const,
                        null
                      ),
                      expectedOutputSchema: fc.constant({ type: "object" }),
                    }),
                    { minLength: orders.length, maxLength: orders.length }
                  )
                  .map((bodies) =>
                    bodies.map((body, i) => ({ ...body, order: orders[i] }))
                  )
              )
          ),
        (steps) => {
          expect(() => validateAndNormalizePlan({ steps })).toThrow(
            PlanValidationError
          );
        }
      ),
      { numRuns: 200 }
    );
  });
});
