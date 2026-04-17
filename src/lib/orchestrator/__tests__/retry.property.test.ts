/**
 * Property-based tests for `executeWithRetry` termination.
 *
 * **Validates: retry loop correctness property** — `executeWithRetry` always
 * terminates within `maxAttempts` iterations regardless of reviewer decisions.
 *
 * Uses `fast-check` for property generation and `vitest` as the test runner.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import * as fc from "fast-check";
import { executeWithRetry } from "../retry";
import type { ExecutionResult, ExecutionContext, ReviewDecision } from "../../../types";
import type { IStepForExecution } from "../../agents/executor/ExecutorAgent";
import type { IExecutorAgent } from "../../agents/executor/ExecutorAgent";
import type { IReviewerAgent } from "../../agents/reviewer/ReviewerAgent";

// ---------------------------------------------------------------------------
// Helpers — build minimal valid objects
// ---------------------------------------------------------------------------

function makeStep(overrides?: Partial<IStepForExecution>): IStepForExecution {
  return {
    _id: "step-1",
    taskId: "task-1",
    description: "Test step",
    suggestedTool: "calculator",
    expectedOutputSchema: { type: "object" },
    ...overrides,
  };
}

function makeContext(overrides?: Partial<ExecutionContext>): ExecutionContext {
  return {
    previousResults: [],
    shortTermMemory: {},
    taskQuery: "test query",
    ...overrides,
  };
}

function makeExecutionResult(overrides?: Partial<ExecutionResult>): ExecutionResult {
  return {
    stepId: "step-1",
    toolUsed: "calculator",
    input: { expression: "1+1" },
    output: { result: 2 },
    status: "success",
    logs: ["[2024-01-01T00:00:00.000Z] Executed"],
    confidence: 0.9,
    createdAt: new Date(),
    ...overrides,
  };
}

function makeRejectDecision(reason = "Not good enough"): ReviewDecision {
  return { decision: "reject", reason, confidence: 0.1 };
}

function makeAcceptDecision(): ReviewDecision {
  return { decision: "accept", reason: "Looks good", confidence: 0.95 };
}

// ---------------------------------------------------------------------------
// Property 1: Retry loop termination — executor never called more than maxAttempts
// ---------------------------------------------------------------------------

describe("executeWithRetry — retry loop termination (property-based)", () => {
  /**
   * **Validates: retry loop correctness property**
   *
   * For any `maxAttempts` in [1, 5] and a reviewer that always rejects,
   * `executor.execute` is called at most `maxAttempts` times and the function
   * always returns (terminates).
   */
  it("never calls executor more than maxAttempts times when reviewer always rejects", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 5 }),
        async (maxAttempts) => {
          const executorMock: IExecutorAgent = {
            execute: vi.fn().mockResolvedValue(makeExecutionResult()),
          };

          const reviewerMock: IReviewerAgent = {
            review: vi.fn().mockResolvedValue(makeRejectDecision()),
          };

          const result = await executeWithRetry(
            makeStep(),
            makeContext(),
            executorMock,
            reviewerMock,
            "test query",
            maxAttempts
          );

          const callCount = (executorMock.execute as ReturnType<typeof vi.fn>).mock.calls.length;

          // Executor must not be called more than maxAttempts times
          expect(callCount).toBeLessThanOrEqual(maxAttempts);

          // Function must always return a result (terminate)
          expect(result).toBeDefined();
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: retry loop correctness property**
   *
   * For any `maxAttempts` in [1, 5] and a reviewer that always rejects,
   * `executor.execute` is called exactly `maxAttempts` times (all attempts
   * are exhausted).
   */
  it("calls executor exactly maxAttempts times when reviewer always rejects", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 5 }),
        async (maxAttempts) => {
          const executorMock: IExecutorAgent = {
            execute: vi.fn().mockResolvedValue(makeExecutionResult()),
          };

          const reviewerMock: IReviewerAgent = {
            review: vi.fn().mockResolvedValue(makeRejectDecision()),
          };

          await executeWithRetry(
            makeStep(),
            makeContext(),
            executorMock,
            reviewerMock,
            "test query",
            maxAttempts
          );

          const callCount = (executorMock.execute as ReturnType<typeof vi.fn>).mock.calls.length;
          expect(callCount).toBe(maxAttempts);
        }
      ),
      { numRuns: 100 }
    );
  });

  // ---------------------------------------------------------------------------
  // Property 2: Returned result always has status "success" or "failure"
  // ---------------------------------------------------------------------------

  /**
   * **Validates: retry loop correctness property**
   *
   * For any `maxAttempts` in [1, 5] and any reviewer behaviour (always reject,
   * always accept, or accept on attempt N), the returned result always has
   * `status` equal to `"success"` or `"failure"` — never `undefined` or any
   * other value.
   */
  it("always returns a result with status 'success' or 'failure' regardless of reviewer decisions", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 5 }),
        // 0 = always reject, 1 = always accept, 2..maxAttempts = accept on attempt N
        fc.integer({ min: 0, max: 5 }),
        async (maxAttempts, acceptOnAttempt) => {
          const executorMock: IExecutorAgent = {
            execute: vi.fn().mockResolvedValue(makeExecutionResult()),
          };

          let callCount = 0;
          const reviewerMock: IReviewerAgent = {
            review: vi.fn().mockImplementation(async () => {
              callCount++;
              if (acceptOnAttempt === 1) {
                return makeAcceptDecision();
              }
              if (acceptOnAttempt >= 2 && callCount === acceptOnAttempt) {
                return makeAcceptDecision();
              }
              return makeRejectDecision();
            }),
          };

          const result = await executeWithRetry(
            makeStep(),
            makeContext(),
            executorMock,
            reviewerMock,
            "test query",
            maxAttempts
          );

          expect(result.status === "success" || result.status === "failure").toBe(true);
          expect(result.status).not.toBeUndefined();
        }
      ),
      { numRuns: 150 }
    );
  });

  // ---------------------------------------------------------------------------
  // Property 3: When reviewer always accepts — executor called exactly once
  // ---------------------------------------------------------------------------

  /**
   * **Validates: retry loop correctness property**
   *
   * When the reviewer always accepts on the first try, `executor.execute` is
   * called exactly once regardless of `maxAttempts`.
   */
  it("calls executor exactly once when reviewer always accepts on first try", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 5 }),
        async (maxAttempts) => {
          const executorMock: IExecutorAgent = {
            execute: vi.fn().mockResolvedValue(makeExecutionResult()),
          };

          const reviewerMock: IReviewerAgent = {
            review: vi.fn().mockResolvedValue(makeAcceptDecision()),
          };

          const result = await executeWithRetry(
            makeStep(),
            makeContext(),
            executorMock,
            reviewerMock,
            "test query",
            maxAttempts
          );

          const callCount = (executorMock.execute as ReturnType<typeof vi.fn>).mock.calls.length;
          expect(callCount).toBe(1);
          expect(result.status).toBe("success");
        }
      ),
      { numRuns: 100 }
    );
  });

  // ---------------------------------------------------------------------------
  // Property 4: When reviewer accepts on attempt N — executor called exactly N times
  // ---------------------------------------------------------------------------

  /**
   * **Validates: retry loop correctness property**
   *
   * When the reviewer accepts on attempt N (and rejects all prior attempts),
   * `executor.execute` is called exactly N times, provided N <= maxAttempts.
   */
  it("calls executor exactly N times when reviewer accepts on attempt N", async () => {
    await fc.assert(
      fc.asyncProperty(
        // acceptOnAttempt in [1, maxAttempts]
        fc.integer({ min: 1, max: 5 }).chain((maxAttempts) =>
          fc.tuple(
            fc.constant(maxAttempts),
            fc.integer({ min: 1, max: maxAttempts })
          )
        ),
        async ([maxAttempts, acceptOnAttempt]) => {
          const executorMock: IExecutorAgent = {
            execute: vi.fn().mockResolvedValue(makeExecutionResult()),
          };

          let reviewCallCount = 0;
          const reviewerMock: IReviewerAgent = {
            review: vi.fn().mockImplementation(async () => {
              reviewCallCount++;
              if (reviewCallCount === acceptOnAttempt) {
                return makeAcceptDecision();
              }
              return makeRejectDecision();
            }),
          };

          const result = await executeWithRetry(
            makeStep(),
            makeContext(),
            executorMock,
            reviewerMock,
            "test query",
            maxAttempts
          );

          const executeCallCount = (executorMock.execute as ReturnType<typeof vi.fn>).mock.calls.length;
          expect(executeCallCount).toBe(acceptOnAttempt);
          expect(result.status).toBe("success");
        }
      ),
      { numRuns: 150 }
    );
  });

  // ---------------------------------------------------------------------------
  // Property 5: Failure result when all attempts exhausted
  // ---------------------------------------------------------------------------

  /**
   * **Validates: retry loop correctness property**
   *
   * When the reviewer always rejects, the returned result always has
   * `status: "failure"`.
   */
  it("returns status 'failure' when reviewer always rejects and all attempts are exhausted", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 5 }),
        async (maxAttempts) => {
          const executorMock: IExecutorAgent = {
            execute: vi.fn().mockResolvedValue(makeExecutionResult()),
          };

          const reviewerMock: IReviewerAgent = {
            review: vi.fn().mockResolvedValue(makeRejectDecision()),
          };

          const result = await executeWithRetry(
            makeStep(),
            makeContext(),
            executorMock,
            reviewerMock,
            "test query",
            maxAttempts
          );

          expect(result.status).toBe("failure");
        }
      ),
      { numRuns: 100 }
    );
  });
});
