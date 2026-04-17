/**
 * executeWithRetry — drives the executor/reviewer loop for a single step,
 * retrying up to `maxAttempts` times and persisting each attempt.
 *
 * Algorithm:
 * 1. Build ExecutionContext (include rejectionReason from previous attempt if any)
 * 2. Call executor.execute(step, context, attempt)
 * 3. If persistExecution provided, call it with the result
 * 4. Call reviewer.review(step, result, taskQuery)
 * 5. Attach reviewDecision to result
 * 6. If decision === "accept": return result immediately
 * 7. If decision === "reject": store rejection reason, increment attempt
 * After loop: return last result with status: "failure"
 *
 * Loop invariant: attempt is strictly increasing, bounded by maxAttempts
 */

import type { ExecutionContext, ExecutionResult } from "../../types";
import type { IExecutorAgent, IStepForExecution } from "../agents/executor/ExecutorAgent";
import type { IReviewerAgent } from "../agents/reviewer/ReviewerAgent";

// ---------------------------------------------------------------------------
// executeWithRetry
// ---------------------------------------------------------------------------

/**
 * Execute a step with retry logic, calling executor and reviewer on each attempt.
 *
 * @param step              - The step to execute (must have _id, taskId, description, etc.)
 * @param initialContext    - Base execution context (previousResults, shortTermMemory, taskQuery)
 * @param executor          - The executor agent to call on each attempt
 * @param reviewer          - The reviewer agent to validate each result
 * @param taskQuery         - The original high-level task query (passed to reviewer)
 * @param maxAttempts       - Maximum number of attempts before giving up (default: 3)
 * @param persistExecution  - Optional callback to persist each attempt as an Execution document
 *
 * @returns ExecutionResult with status "success" if any attempt was accepted,
 *          or status "failure" if all attempts were rejected.
 */
export async function executeWithRetry(
  step: IStepForExecution,
  initialContext: ExecutionContext,
  executor: IExecutorAgent,
  reviewer: IReviewerAgent,
  taskQuery: string,
  maxAttempts: number = 3,
  persistExecution?: (stepId: string, result: ExecutionResult) => Promise<void>
): Promise<ExecutionResult> {
  let attempt = 1;
  let lastResult: ExecutionResult | null = null;
  let rejectionReason: string | undefined;

  // Loop invariant: attempt <= maxAttempts + 1 at the start of each iteration
  while (attempt <= maxAttempts) {
    // Step 1: Build context, injecting rejection reason from previous attempt
    const context: ExecutionContext = {
      ...initialContext,
      rejectionReason,
    };

    // Step 2: Execute the step
    const result = await executor.execute(step, context, attempt);

    // Step 3: Persist the attempt if a callback was provided
    if (persistExecution) {
      await persistExecution(step._id, result);
    }

    // Step 4: Review the result
    const review = await reviewer.review(step, result, taskQuery);

    // Step 5: Attach reviewDecision to result
    result.reviewDecision = review;

    // Step 6: Accept → return immediately
    if (review.decision === "accept") {
      return result;
    }

    // Step 7: Reject → store reason, increment attempt
    rejectionReason = review.reason;
    lastResult = result;
    attempt++;
  }

  // All attempts exhausted — return last result with status: "failure"
  return {
    ...lastResult!,
    status: "failure",
  };
}
