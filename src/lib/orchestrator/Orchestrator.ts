/**
 * Orchestrator — central coordinator that drives the full task lifecycle:
 * planning → execution → review → final result assembly.
 *
 * Responsibilities:
 * - Invoke Planner to decompose the query into steps
 * - Persist steps to MongoDB
 * - Manage the executor/reviewer loop with retry logic (via executeWithRetry)
 * - Persist Execution documents after each step
 * - Update Task and Step status in MongoDB at each lifecycle transition
 * - Emit progress events (SSE-compatible) after each step completes
 * - Assemble and persist the FinalResult on completion
 *
 * Loop invariant: all steps at index < i are in a terminal status before
 * step i begins.
 */

import type { FinalResult, ExecutionResult, PlannedStep } from "../../types";
import type { IPlannerAgent } from "../agents/planner/PlannerAgent";
import type { IExecutorAgent } from "../agents/executor/ExecutorAgent";
import type { IReviewerAgent } from "../agents/reviewer/ReviewerAgent";
import type { IMemorySystem } from "../memory/MemorySystem";
import { executeWithRetry } from "./retry";
import { assembleFinalResult } from "./assembly";
import Task, { ITask } from "../models/Task";
import Step, { IStep } from "../models/Step";
import Execution from "../models/Execution";
import { Types } from "mongoose";

// ---------------------------------------------------------------------------
// ProgressEvent type (SSE-compatible)
// ---------------------------------------------------------------------------

export interface ProgressEvent {
  stepId: string;
  status: "completed" | "failed";
  stepIndex: number;
  totalSteps: number;
}

// ---------------------------------------------------------------------------
// Orchestrator interface (mirrors design.md)
// ---------------------------------------------------------------------------

export interface IOrchestratorDeps {
  planner: IPlannerAgent;
  executor: IExecutorAgent;
  reviewer: IReviewerAgent;
  memory: IMemorySystem;
  onProgress?: (taskId: string, event: ProgressEvent) => void;
}

// ---------------------------------------------------------------------------
// TaskStatus type (populated task document)
// ---------------------------------------------------------------------------

export type TaskStatus = ITask;

// ---------------------------------------------------------------------------
// Custom error for task execution failures
// ---------------------------------------------------------------------------

export class TaskExecutionError extends Error {
  stepId: string;
  result: ExecutionResult;

  constructor(stepId: string, result: ExecutionResult) {
    super(`Step "${stepId}" failed after all retry attempts`);
    this.name = "TaskExecutionError";
    this.stepId = stepId;
    this.result = result;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

// ---------------------------------------------------------------------------
// Orchestrator implementation
// ---------------------------------------------------------------------------

export class Orchestrator {
  private planner: IPlannerAgent;
  private executor: IExecutorAgent;
  private reviewer: IReviewerAgent;
  private memory: IMemorySystem;
  private onProgress?: (taskId: string, event: ProgressEvent) => void;

  constructor(deps: IOrchestratorDeps) {
    this.planner = deps.planner;
    this.executor = deps.executor;
    this.reviewer = deps.reviewer;
    this.memory = deps.memory;
    this.onProgress = deps.onProgress;
  }

  // -------------------------------------------------------------------------
  // startTask
  // -------------------------------------------------------------------------

  /**
   * Execute the full task lifecycle for `taskId`.
   *
   * 1. Update Task status to "planning"
   * 2. Retrieve relevant memory and call planner.plan()
   * 3. Persist each PlannedStep as a Step document
   * 4. Update Task status to "executing", store step IDs on task
   * 5. For each step (in order):
   *    a. Call executeWithRetry (persisting each Execution document)
   *    b. Update Step status to "completed" or "failed"
   *    c. Emit onProgress event
   * 6. If any step fails: update Task status to "failed", throw TaskExecutionError
   * 7. Call assembleFinalResult
   * 8. Update Task status to "completed", store finalResult
   * 9. Return FinalResult
   *
   * Loop invariant: all steps at index < i are in a terminal status before
   * step i begins.
   *
   * @param taskId - ID of an existing Task document with status "pending"
   * @param query  - The original user query
   */
  async startTask(taskId: string, query: string): Promise<FinalResult> {
    // Step 1: Update Task status to "planning"
    await Task.findByIdAndUpdate(taskId, { status: "planning" });

    // Step 2: Retrieve relevant memory and plan
    const relevantMemory = await this.memory.retrieveRelevant(query, 5);
    const plannedSteps: PlannedStep[] = await this.planner.plan(query, {
      relevantMemory,
    });

    // Step 3: Persist each PlannedStep as a Step document
    const stepDocs: IStep[] = [];
    for (const planned of plannedSteps) {
      const step = await Step.create({
        taskId: new Types.ObjectId(taskId),
        description: planned.description,
        order: planned.order,
        status: "pending",
        suggestedTool: planned.suggestedTool,
        expectedOutputSchema: planned.expectedOutputSchema,
        executions: [],
      });
      stepDocs.push(step);
    }

    // Step 4: Update Task status to "executing", store step IDs
    const stepIds = stepDocs.map((s) => s._id);
    await Task.findByIdAndUpdate(taskId, {
      status: "executing",
      steps: stepIds,
    });

    // Step 5: Execute each step in order (loop invariant enforced by sequential await)
    const allResults: ExecutionResult[] = [];
    const totalSteps = stepDocs.length;

    for (let i = 0; i < stepDocs.length; i++) {
      const stepDoc = stepDocs[i];
      const stepId = stepDoc._id.toString();

      // Update step status to "executing"
      await Step.findByIdAndUpdate(stepDoc._id, { status: "executing" });

      // Build the persist callback for each execution attempt
      const persistExecution = async (
        _stepId: string,
        result: ExecutionResult
      ): Promise<void> => {
        const execDoc = await Execution.create({
          stepId: stepDoc._id,
          attempt: stepDoc.executions.length + 1,
          toolUsed: result.toolUsed,
          input: result.input,
          output: result.output,
          status: result.status,
          reviewDecision: result.reviewDecision,
          logs: result.logs,
          confidence: result.confidence,
        });

        // Append execution ID to step's executions array
        await Step.findByIdAndUpdate(stepDoc._id, {
          $push: { executions: execDoc._id },
        });
      };

      // Build execution context from all previous results
      const shortTermMemory = (await this.memory.getShortTerm(
        `task:${taskId}`
      )) as Record<string, unknown> | null;

      const context = {
        previousResults: allResults,
        shortTermMemory: shortTermMemory ?? {},
        taskQuery: query,
      };

      // Build a minimal IStepForExecution from the Mongoose document
      const stepForExecution = {
        _id: stepId,
        taskId,
        description: stepDoc.description,
        suggestedTool: stepDoc.suggestedTool,
        expectedOutputSchema: stepDoc.expectedOutputSchema,
      };

      // Execute with retry (loop invariant: all steps < i are terminal)
      const result = await executeWithRetry(
        stepForExecution,
        context,
        this.executor,
        this.reviewer,
        query,
        3,
        persistExecution
      );

      if (result.status === "failure") {
        // Update step and task to "failed"
        await Step.findByIdAndUpdate(stepDoc._id, { status: "failed" });
        await Task.findByIdAndUpdate(taskId, {
          status: "failed",
          errorMessage: `Step "${stepDoc.description}" failed after all retry attempts`,
        });

        // Emit progress event for the failed step
        if (this.onProgress) {
          this.onProgress(taskId, {
            stepId,
            status: "failed",
            stepIndex: i,
            totalSteps,
          });
        }

        throw new TaskExecutionError(stepId, result);
      }

      // Step completed successfully
      await Step.findByIdAndUpdate(stepDoc._id, {
        status: "completed",
        finalExecutionId: stepDoc.executions[stepDoc.executions.length - 1],
      });

      allResults.push(result);

      // Emit progress event
      if (this.onProgress) {
        this.onProgress(taskId, {
          stepId,
          status: "completed",
          stepIndex: i,
          totalSteps,
        });
      }
    }

    // Step 7: Assemble final result
    const finalResult = assembleFinalResult(query, allResults);

    // Step 8: Update Task status to "completed", store finalResult
    await Task.findByIdAndUpdate(taskId, {
      status: "completed",
      finalResult,
    });

    // Step 9: Return FinalResult
    return finalResult;
  }

  // -------------------------------------------------------------------------
  // getTaskStatus
  // -------------------------------------------------------------------------

  /**
   * Query MongoDB for the current state of a task, with steps populated.
   *
   * @param taskId - The task ID to look up.
   * @returns The Task document with steps populated.
   * @throws If the task is not found.
   */
  async getTaskStatus(taskId: string): Promise<TaskStatus> {
    const task = await Task.findById(taskId).populate("steps");
    if (!task) {
      throw new Error(`Task not found: ${taskId}`);
    }
    return task;
  }

  // -------------------------------------------------------------------------
  // abortTask
  // -------------------------------------------------------------------------

  /**
   * Abort a running task by marking it and all pending/executing steps as "failed".
   *
   * @param taskId - The task ID to abort.
   */
  async abortTask(taskId: string): Promise<void> {
    // Mark the task as failed
    await Task.findByIdAndUpdate(taskId, {
      status: "failed",
      errorMessage: "Task aborted by user",
    });

    // Mark all pending or executing steps as failed
    await Step.updateMany(
      {
        taskId: new Types.ObjectId(taskId),
        status: { $in: ["pending", "executing"] },
      },
      { status: "failed" }
    );
  }
}
