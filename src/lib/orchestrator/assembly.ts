/**
 * assembleFinalResult — assembles a FinalResult from the task query and all
 * step execution results.
 *
 * Preconditions:
 * - taskQuery is non-empty
 * - stepResults is non-empty and all results have status === "success"
 * - Results are ordered by step order ascending
 *
 * Postconditions:
 * - Returns a FinalResult with a non-empty summary
 * - finalResult.stepResults contains all input results in the same order
 * - finalResult.data is a deterministic structured aggregation of all step outputs
 *
 * Determinism guarantee: same inputs always produce structurally equivalent outputs.
 * The function is pure — no randomness, no side effects, no Date.now() calls.
 */

import type { ExecutionResult, FinalResult } from "../../types";

/**
 * Assemble a FinalResult from the task query and all step execution results.
 *
 * @param taskQuery   - The original high-level task query (must be non-empty).
 * @param stepResults - All execution results ordered by step order ascending
 *                      (all must have status === "success").
 *
 * @returns A deterministic FinalResult with summary, structured data, and stepResults.
 *
 * @throws {Error} if taskQuery is empty or stepResults is empty.
 */
export function assembleFinalResult(
  taskQuery: string,
  stepResults: ExecutionResult[]
): FinalResult {
  // Precondition: taskQuery must be non-empty
  if (!taskQuery || taskQuery.trim().length === 0) {
    throw new Error("assembleFinalResult: taskQuery must be non-empty");
  }

  // Precondition: stepResults must be non-empty
  if (!stepResults || stepResults.length === 0) {
    throw new Error("assembleFinalResult: stepResults must be non-empty");
  }

  // Aggregate all step outputs into a deterministic structured data object.
  // Keys are step_1, step_2, ... to ensure stable ordering.
  const data: Record<string, unknown> = {};
  for (let i = 0; i < stepResults.length; i++) {
    const result = stepResults[i];
    data[`step_${i + 1}`] = {
      toolUsed: result.toolUsed,
      output: result.output,
      confidence: result.confidence,
    };
  }

  // Build a deterministic summary from the query and step results.
  const toolsUsed = [...new Set(stepResults.map((r) => r.toolUsed))].sort().join(", ");
  const stepCount = stepResults.length;
  const summary = [
    `Task completed: "${taskQuery.trim()}"`,
    `Executed ${stepCount} step${stepCount === 1 ? "" : "s"} using tools: ${toolsUsed}.`,
  ].join(" ");

  return {
    summary,
    data,
    stepResults,
  };
}
