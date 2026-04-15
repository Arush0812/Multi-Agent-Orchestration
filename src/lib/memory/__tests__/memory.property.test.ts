/**
 * Property-based tests for MemorySystem namespacing isolation.
 *
 * **Validates: Requirements 3.3** — Memory namespacing isolation property:
 * storing under `taskId:A` never affects retrieval under `taskId:B`
 * for any two distinct task IDs.
 *
 * Uses `fast-check` for property generation and `vitest` as the test runner.
 */

import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { MemorySystem } from "../MemorySystem";

// ---------------------------------------------------------------------------
// Arbitraries
// ---------------------------------------------------------------------------

/**
 * Generates a non-empty alphanumeric string suitable for use as a task ID.
 * Constrained to printable ASCII to avoid key encoding edge cases.
 */
const taskIdArb = fc
  .string({ minLength: 1, maxLength: 32 })
  .filter((s) => s.trim().length > 0);

/**
 * Generates a pair of *distinct* task IDs.
 */
const distinctTaskIdPairArb = fc
  .tuple(taskIdArb, taskIdArb)
  .filter(([a, b]) => a !== b);

/**
 * Generates arbitrary JSON-serializable values (primitives, arrays, objects).
 */
const jsonValueArb = fc.jsonValue();

// ---------------------------------------------------------------------------
// Property: isolation — storing under key A does not affect retrieval under key B
// ---------------------------------------------------------------------------

describe("MemorySystem — namespacing isolation (property-based)", () => {
  /**
   * **Validates: Requirements 3.3**
   *
   * Property: for any two distinct task IDs A and B, storing a value under
   * `task:${A}:data` must not affect the value retrieved under `task:${B}:data`.
   * The latter must remain `null` (no cross-contamination).
   */
  it("storing under taskId A does not affect retrieval under taskId B", async () => {
    await fc.assert(
      fc.asyncProperty(
        distinctTaskIdPairArb,
        jsonValueArb,
        async ([taskIdA, taskIdB], value) => {
          const memory = new MemorySystem(); // no Redis URL → in-memory fallback

          const keyA = `task:${taskIdA}:data`;
          const keyB = `task:${taskIdB}:data`;

          await memory.storeShortTerm(keyA, value);

          const retrieved = await memory.getShortTerm(keyB);
          expect(retrieved).toBeNull();
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 3.3**
   *
   * Positive case: storing under key A and retrieving under key A returns
   * the original value (round-trip correctness).
   */
  it("storing under taskId A and retrieving under taskId A returns the stored value", async () => {
    await fc.assert(
      fc.asyncProperty(taskIdArb, jsonValueArb, async (taskId, value) => {
        const memory = new MemorySystem(); // no Redis URL → in-memory fallback

        const key = `task:${taskId}:data`;

        await memory.storeShortTerm(key, value);

        const retrieved = await memory.getShortTerm(key);
        expect(retrieved).toEqual(value);
      }),
      { numRuns: 100 }
    );
  });
});
