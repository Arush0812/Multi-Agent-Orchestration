/**
 * assembleFinalResult — assembles a FinalResult from the task query and all
 * step execution results.
 *
 * This is a stub implementation that will be fully implemented in task 8.4.
 *
 * Preconditions:
 * - taskQuery is non-empty
 * - stepResults is non-empty and all results have status === "success"
 * - Results are ordered by step order ascending
 *
 * Postconditions:
 * - Returns a FinalResult with a non-empty summary
 * - finalResult.stepResults contains all input results
 * - finalResult.data is a structured aggregation of all step outputs
 */

import type { ExecutionResult, FinalResult } from "../../types";

/**
 * Assemble a FinalResult from the task query and all step execution results.
 *
 * @param taskQuery   - The original high-level task query.
 * @param stepResults - All execution results, ordered by step order ascending.
 *
 * @returns A FinalResult with summary, data, and stepResults.
 */
export function assembleFinalResult(
  taskQuery: string,
  stepResults: ExecutionResult[]
): FinalResult {
  // Aggregate all step outputs into a structured data object
  const data: Record<string, unknown> = {};
  for (let i = 0; i < stepResults.length; i++) {
    data[`step_${i + 1}`] = stepResults[i].output;
  }

  // Build a summary from the query and step count
  const summary = `Completed task: "${taskQuery}" in ${stepResults.length} step${stepResults.length === 1 ? "" : "s"}.`;

  return {
    summary,
    data,
    stepResults,
  };
}
