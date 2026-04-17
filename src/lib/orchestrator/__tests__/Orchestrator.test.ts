/**
 * Unit tests for Orchestrator.
 *
 * Tests cover:
 * - Happy path: plan → execute → review accept → task reaches "completed" status
 * - Failure propagation: executor returns failure, reviewer rejects all 3 attempts → TaskExecutionError thrown, task marked "failed"
 * - abortTask: marks task and pending/executing steps as "failed"
 *
 * MongoDB models are fully mocked — no real DB connection is made.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { Orchestrator, TaskExecutionError, type IOrchestratorDeps } from "../Orchestrator";
import type { IPlannerAgent } from "../../agents/planner/PlannerAgent";
import type { IExecutorAgent } from "../../agents/executor/ExecutorAgent";
import type { IReviewerAgent } from "../../agents/reviewer/ReviewerAgent";
import type { IMemorySystem } from "../../memory/MemorySystem";
import type { ExecutionResult, PlannedStep, ReviewDecision } from "../../../types";

// ---------------------------------------------------------------------------
// Mongoose model mocks — vi.mock factories are hoisted, so we cannot
// reference variables declared in module scope. Use vi.hoisted() to share
// values between the factory and the test body.
// ---------------------------------------------------------------------------

const { mockTaskId, mockStepId } = vi.hoisted(() => {
  const { Types } = require("mongoose") as typeof import("mongoose");
  return {
    mockTaskId: new Types.ObjectId().toString(),
    mockStepId: new Types.ObjectId(),
  };
});

vi.mock("../../models/Task", () => ({
  default: {
    findByIdAndUpdate: vi.fn().mockResolvedValue({}),
    findById: vi.fn().mockReturnValue({
      populate: vi.fn().mockResolvedValue({
        _id: mockTaskId,
        userQuery: "test query",
        status: "pending",
        steps: [],
      }),
    }),
    updateMany: vi.fn().mockResolvedValue({}),
  },
}));

vi.mock("../../models/Step", () => ({
  default: {
    create: vi.fn().mockResolvedValue({
      _id: mockStepId,
      executions: [],
      description: "test step",
      suggestedTool: "web_search",
      expectedOutputSchema: {},
    }),
    findByIdAndUpdate: vi.fn().mockResolvedValue({}),
    updateMany: vi.fn().mockResolvedValue({}),
  },
}));

vi.mock("../../models/Execution", () => {
  const { Types } = require("mongoose") as typeof import("mongoose");
  return {
    default: {
      create: vi.fn().mockResolvedValue({ _id: new Types.ObjectId() }),
    },
  };
});

// ---------------------------------------------------------------------------
// Import mocked models (after vi.mock declarations)
// ---------------------------------------------------------------------------

import Task from "../../models/Task";
import Step from "../../models/Step";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const plannedStep: PlannedStep = {
  order: 1,
  description: "test step",
  suggestedTool: "web_search",
  expectedOutputSchema: {},
};

const successResult: ExecutionResult = {
  stepId: mockStepId.toString(),
  toolUsed: "web_search",
  input: { query: "test step" },
  output: { result: "some output" },
  status: "success",
  logs: ["[2024-01-01T00:00:00.000Z] Attempt 1: executing step"],
  confidence: 0.8,
  createdAt: new Date("2024-01-01"),
};

const failureResult: ExecutionResult = {
  stepId: mockStepId.toString(),
  toolUsed: "web_search",
  input: { query: "test step" },
  output: null,
  status: "failure",
  logs: ["[2024-01-01T00:00:00.000Z] Error: tool failed"],
  confidence: 0,
  createdAt: new Date("2024-01-01"),
};

const acceptDecision: ReviewDecision = {
  decision: "accept",
  reason: "Output looks good",
  confidence: 0.9,
};

const rejectDecision: ReviewDecision = {
  decision: "reject",
  reason: "Output is insufficient",
  confidence: 0.1,
};

// ---------------------------------------------------------------------------
// Mock factories
// ---------------------------------------------------------------------------

function makeMockPlanner(steps: PlannedStep[] = [plannedStep]): IPlannerAgent {
  return {
    plan: vi.fn().mockResolvedValue(steps),
  };
}

function makeMockExecutor(result: ExecutionResult = successResult): IExecutorAgent {
  return {
    execute: vi.fn().mockResolvedValue(result),
  };
}

function makeMockReviewer(decision: ReviewDecision = acceptDecision): IReviewerAgent {
  return {
    review: vi.fn().mockResolvedValue(decision),
  };
}

function makeMockMemory(): IMemorySystem {
  return {
    storeShortTerm: vi.fn().mockResolvedValue(undefined),
    getShortTerm: vi.fn().mockResolvedValue(null),
    storeLongTerm: vi.fn().mockResolvedValue(undefined),
    retrieveRelevant: vi.fn().mockResolvedValue([]),
  };
}

function makeOrchestrator(overrides: Partial<IOrchestratorDeps> = {}): Orchestrator {
  return new Orchestrator({
    planner: makeMockPlanner(),
    executor: makeMockExecutor(),
    reviewer: makeMockReviewer(),
    memory: makeMockMemory(),
    ...overrides,
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Orchestrator", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Reset Step.create to return a fresh mock step each call
    vi.mocked(Step.create).mockResolvedValue({
      _id: mockStepId,
      executions: [],
      description: "test step",
      suggestedTool: "web_search",
      expectedOutputSchema: {},
    } as never);
  });

  // -------------------------------------------------------------------------
  // 1. Happy path
  // -------------------------------------------------------------------------

  describe("happy path", () => {
    it("returns a FinalResult with a non-empty summary when step is accepted", async () => {
      const orchestrator = makeOrchestrator();

      const result = await orchestrator.startTask(mockTaskId, "test query");

      expect(result).toBeDefined();
      expect(typeof result.summary).toBe("string");
      expect(result.summary.length).toBeGreaterThan(0);
    });

    it("calls Task.findByIdAndUpdate with status 'completed'", async () => {
      const orchestrator = makeOrchestrator();

      await orchestrator.startTask(mockTaskId, "test query");

      const calls = vi.mocked(Task.findByIdAndUpdate).mock.calls;
      const completedCall = calls.find(
        ([, update]) =>
          typeof update === "object" &&
          update !== null &&
          (update as Record<string, unknown>).status === "completed"
      );
      expect(completedCall).toBeDefined();
    });

    it("calls planner.plan with the task query", async () => {
      const planner = makeMockPlanner();
      const orchestrator = makeOrchestrator({ planner });

      await orchestrator.startTask(mockTaskId, "test query");

      expect(planner.plan).toHaveBeenCalledWith(
        "test query",
        expect.objectContaining({ relevantMemory: expect.any(Array) })
      );
    });

    it("calls executor.execute for each planned step", async () => {
      const executor = makeMockExecutor();
      const orchestrator = makeOrchestrator({ executor });

      await orchestrator.startTask(mockTaskId, "test query");

      expect(executor.execute).toHaveBeenCalledTimes(1);
    });

    it("calls reviewer.review after each execution", async () => {
      const reviewer = makeMockReviewer();
      const orchestrator = makeOrchestrator({ reviewer });

      await orchestrator.startTask(mockTaskId, "test query");

      expect(reviewer.review).toHaveBeenCalledTimes(1);
    });

    it("FinalResult.stepResults contains the accepted execution result", async () => {
      const orchestrator = makeOrchestrator();

      const result = await orchestrator.startTask(mockTaskId, "test query");

      expect(result.stepResults).toHaveLength(1);
      expect(result.stepResults[0].status).toBe("success");
    });

    it("transitions task through planning → executing → completed statuses", async () => {
      const orchestrator = makeOrchestrator();

      await orchestrator.startTask(mockTaskId, "test query");

      const statusArgs = vi
        .mocked(Task.findByIdAndUpdate)
        .mock.calls.map(([, update]) => (update as Record<string, unknown>).status)
        .filter(Boolean);

      expect(statusArgs).toContain("planning");
      expect(statusArgs).toContain("executing");
      expect(statusArgs).toContain("completed");
    });

    it("creates Step documents for each planned step", async () => {
      const orchestrator = makeOrchestrator();

      await orchestrator.startTask(mockTaskId, "test query");

      expect(Step.create).toHaveBeenCalledTimes(1);
    });
  });

  // -------------------------------------------------------------------------
  // 2. Failure propagation
  // -------------------------------------------------------------------------

  describe("failure propagation", () => {
    it("throws TaskExecutionError when all retry attempts are rejected", async () => {
      // Executor always returns failure; reviewer always rejects
      const executor = makeMockExecutor(failureResult);
      const reviewer = makeMockReviewer(rejectDecision);
      const orchestrator = makeOrchestrator({ executor, reviewer });

      await expect(
        orchestrator.startTask(mockTaskId, "test query")
      ).rejects.toThrow(TaskExecutionError);
    });

    it("calls Task.findByIdAndUpdate with status 'failed' on step failure", async () => {
      const executor = makeMockExecutor(failureResult);
      const reviewer = makeMockReviewer(rejectDecision);
      const orchestrator = makeOrchestrator({ executor, reviewer });

      await expect(
        orchestrator.startTask(mockTaskId, "test query")
      ).rejects.toThrow(TaskExecutionError);

      const calls = vi.mocked(Task.findByIdAndUpdate).mock.calls;
      const failedCall = calls.find(
        ([, update]) =>
          typeof update === "object" &&
          update !== null &&
          (update as Record<string, unknown>).status === "failed"
      );
      expect(failedCall).toBeDefined();
    });

    it("executor is called up to maxAttempts (3) times before giving up", async () => {
      const executor = makeMockExecutor(failureResult);
      const reviewer = makeMockReviewer(rejectDecision);
      const orchestrator = makeOrchestrator({ executor, reviewer });

      await expect(
        orchestrator.startTask(mockTaskId, "test query")
      ).rejects.toThrow(TaskExecutionError);

      // executeWithRetry loops up to 3 times
      expect(executor.execute).toHaveBeenCalledTimes(3);
    });

    it("TaskExecutionError carries the failed stepId", async () => {
      const executor = makeMockExecutor(failureResult);
      const reviewer = makeMockReviewer(rejectDecision);
      const orchestrator = makeOrchestrator({ executor, reviewer });

      let thrownError: TaskExecutionError | undefined;
      try {
        await orchestrator.startTask(mockTaskId, "test query");
      } catch (err) {
        if (err instanceof TaskExecutionError) {
          thrownError = err;
        }
      }

      expect(thrownError).toBeDefined();
      expect(typeof thrownError!.stepId).toBe("string");
    });

    it("TaskExecutionError carries the last ExecutionResult", async () => {
      const executor = makeMockExecutor(failureResult);
      const reviewer = makeMockReviewer(rejectDecision);
      const orchestrator = makeOrchestrator({ executor, reviewer });

      let thrownError: TaskExecutionError | undefined;
      try {
        await orchestrator.startTask(mockTaskId, "test query");
      } catch (err) {
        if (err instanceof TaskExecutionError) {
          thrownError = err;
        }
      }

      expect(thrownError).toBeDefined();
      expect(thrownError!.result).toBeDefined();
      expect(thrownError!.result.status).toBe("failure");
    });
  });

  // -------------------------------------------------------------------------
  // 3. abortTask
  // -------------------------------------------------------------------------

  describe("abortTask", () => {
    it("calls Task.findByIdAndUpdate with status 'failed'", async () => {
      const orchestrator = makeOrchestrator();

      await orchestrator.abortTask(mockTaskId);

      expect(Task.findByIdAndUpdate).toHaveBeenCalledWith(
        mockTaskId,
        expect.objectContaining({ status: "failed" })
      );
    });

    it("calls Step.updateMany with status 'failed' for pending/executing steps", async () => {
      const orchestrator = makeOrchestrator();

      await orchestrator.abortTask(mockTaskId);

      expect(Step.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          status: expect.objectContaining({ $in: expect.arrayContaining(["pending", "executing"]) }),
        }),
        { status: "failed" }
      );
    });

    it("includes the taskId filter when updating steps", async () => {
      const orchestrator = makeOrchestrator();

      await orchestrator.abortTask(mockTaskId);

      const [filter] = vi.mocked(Step.updateMany).mock.calls[0];
      expect(filter).toHaveProperty("taskId");
    });

    it("sets errorMessage to indicate user abort on the task", async () => {
      const orchestrator = makeOrchestrator();

      await orchestrator.abortTask(mockTaskId);

      expect(Task.findByIdAndUpdate).toHaveBeenCalledWith(
        mockTaskId,
        expect.objectContaining({ errorMessage: expect.stringContaining("abort") })
      );
    });
  });
});
