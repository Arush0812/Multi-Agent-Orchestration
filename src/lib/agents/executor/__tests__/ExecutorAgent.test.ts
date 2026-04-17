/**
 * Unit tests for ExecutorAgent.
 *
 * Tests cover:
 * - ExecutionResult shape: correct fields returned on success
 * - Log population: logs contain timestamped entries with attempt number and tool name
 * - Failure path: registry.invoke throws → status:"failure", confidence:0, error in logs
 * - Short-term memory key: storeShortTerm called with `task:{taskId}:step:{stepId}`
 * - selectTool fast path: suggestedTool set and registered → Gemini not called
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { ExecutorAgent, type IStepForExecution } from "../ExecutorAgent";
import type { IToolRegistry } from "../../../tools/ToolRegistry";
import type { IMemorySystem } from "../../../memory/MemorySystem";
import type { IGeminiClient } from "../toolSelection";
import type { ExecutionContext, ToolOutput } from "../../../../types";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const validStep: IStepForExecution = {
  _id: "step-1",
  taskId: "task-1",
  description: "Search for AI news",
  suggestedTool: "web_search",
  expectedOutputSchema: { type: "object" },
};

const validContext: ExecutionContext = {
  previousResults: [],
  shortTermMemory: {},
  taskQuery: "test query",
};

const successfulToolOutput: ToolOutput = {
  result: { articles: ["AI news item 1", "AI news item 2"] },
  metadata: { source: "web_search", count: 2 },
};

// ---------------------------------------------------------------------------
// Mock factories
// ---------------------------------------------------------------------------

function makeMockRegistry(overrides?: Partial<IToolRegistry>): IToolRegistry {
  return {
    getTool: vi.fn().mockReturnValue({
      name: "web_search",
      description: "Search the web",
      inputSchema: {},
      outputSchema: {},
      execute: vi.fn(),
    }),
    listTools: vi.fn().mockReturnValue([
      { name: "web_search", description: "Search the web", inputSchema: {}, outputSchema: {} },
    ]),
    invoke: vi.fn().mockResolvedValue(successfulToolOutput),
    ...overrides,
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

function makeMockGemini(): IGeminiClient {
  const generateContent = vi.fn().mockResolvedValue({
    response: { text: () => JSON.stringify({ toolName: "web_search" }) },
  });
  return {
    getGenerativeModel: vi.fn().mockReturnValue({ generateContent }),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ExecutorAgent", () => {
  let registry: IToolRegistry;
  let memory: IMemorySystem;
  let gemini: IGeminiClient;
  let agent: ExecutorAgent;

  beforeEach(() => {
    registry = makeMockRegistry();
    memory = makeMockMemory();
    gemini = makeMockGemini();
    agent = new ExecutorAgent(registry, memory, gemini);
  });

  // -------------------------------------------------------------------------
  // 1. ExecutionResult shape
  // -------------------------------------------------------------------------

  describe("ExecutionResult shape", () => {
    it("returns a result with all required fields on success", async () => {
      const result = await agent.execute(validStep, validContext, 1);

      expect(result).toMatchObject({
        stepId: "step-1",
        toolUsed: "web_search",
        input: expect.objectContaining({ query: "Search for AI news" }),
        output: successfulToolOutput,
        status: "success",
        confidence: expect.any(Number),
      });

      // logs must be an array
      expect(Array.isArray(result.logs)).toBe(true);

      // createdAt must be a Date
      expect(result.createdAt).toBeInstanceOf(Date);
    });

    it("returns status:'success' when tool invocation succeeds", async () => {
      const result = await agent.execute(validStep, validContext, 1);
      expect(result.status).toBe("success");
    });

    it("returns the tool output as the output field", async () => {
      const result = await agent.execute(validStep, validContext, 1);
      expect(result.output).toEqual(successfulToolOutput);
    });

    it("returns a confidence value between 0 and 1", async () => {
      const result = await agent.execute(validStep, validContext, 1);
      expect(result.confidence).toBeGreaterThanOrEqual(0);
      expect(result.confidence).toBeLessThanOrEqual(1);
    });
  });

  // -------------------------------------------------------------------------
  // 2. Log population
  // -------------------------------------------------------------------------

  describe("log population", () => {
    it("logs array is non-empty after execution", async () => {
      const result = await agent.execute(validStep, validContext, 1);
      expect(result.logs.length).toBeGreaterThan(0);
    });

    it("logs contain an entry with the attempt number", async () => {
      const result = await agent.execute(validStep, validContext, 3);
      const hasAttemptLog = result.logs.some((log) => log.includes("Attempt 3"));
      expect(hasAttemptLog).toBe(true);
    });

    it("logs contain an entry mentioning the tool name", async () => {
      const result = await agent.execute(validStep, validContext, 1);
      const hasToolLog = result.logs.some((log) => log.includes("web_search"));
      expect(hasToolLog).toBe(true);
    });

    it("log entries are timestamped (ISO format)", async () => {
      const result = await agent.execute(validStep, validContext, 1);
      // Each log entry should start with a bracketed ISO timestamp
      const isoPattern = /^\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;
      result.logs.forEach((log) => {
        expect(log).toMatch(isoPattern);
      });
    });
  });

  // -------------------------------------------------------------------------
  // 3. Failure path
  // -------------------------------------------------------------------------

  describe("failure path", () => {
    it("returns status:'failure' when registry.invoke throws", async () => {
      const failingRegistry = makeMockRegistry({
        invoke: vi.fn().mockRejectedValue(new Error("Tool invocation failed")),
      });
      const failAgent = new ExecutorAgent(failingRegistry, memory, gemini);

      const result = await failAgent.execute(validStep, validContext, 1);

      expect(result.status).toBe("failure");
    });

    it("returns confidence:0 on failure", async () => {
      const failingRegistry = makeMockRegistry({
        invoke: vi.fn().mockRejectedValue(new Error("Network error")),
      });
      const failAgent = new ExecutorAgent(failingRegistry, memory, gemini);

      const result = await failAgent.execute(validStep, validContext, 1);

      expect(result.confidence).toBe(0);
    });

    it("includes the error message in logs on failure", async () => {
      const errorMessage = "Tool invocation failed: timeout";
      const failingRegistry = makeMockRegistry({
        invoke: vi.fn().mockRejectedValue(new Error(errorMessage)),
      });
      const failAgent = new ExecutorAgent(failingRegistry, memory, gemini);

      const result = await failAgent.execute(validStep, validContext, 1);

      const hasErrorLog = result.logs.some((log) => log.includes(errorMessage));
      expect(hasErrorLog).toBe(true);
    });

    it("never throws — always returns an ExecutionResult even on error", async () => {
      const failingRegistry = makeMockRegistry({
        invoke: vi.fn().mockRejectedValue(new Error("Catastrophic failure")),
      });
      const failAgent = new ExecutorAgent(failingRegistry, memory, gemini);

      await expect(failAgent.execute(validStep, validContext, 1)).resolves.toBeDefined();
    });

    it("returns the correct stepId on failure", async () => {
      const failingRegistry = makeMockRegistry({
        invoke: vi.fn().mockRejectedValue(new Error("fail")),
      });
      const failAgent = new ExecutorAgent(failingRegistry, memory, gemini);

      const result = await failAgent.execute(validStep, validContext, 1);

      expect(result.stepId).toBe("step-1");
    });
  });

  // -------------------------------------------------------------------------
  // 4. Short-term memory key
  // -------------------------------------------------------------------------

  describe("short-term memory key", () => {
    it("calls storeShortTerm with key 'task:{taskId}:step:{stepId}'", async () => {
      await agent.execute(validStep, validContext, 1);

      expect(memory.storeShortTerm).toHaveBeenCalledWith(
        "task:task-1:step:step-1",
        expect.anything()
      );
    });

    it("stores the tool output as the memory value", async () => {
      await agent.execute(validStep, validContext, 1);

      expect(memory.storeShortTerm).toHaveBeenCalledWith(
        expect.any(String),
        successfulToolOutput
      );
    });

    it("does not call storeShortTerm on failure", async () => {
      const failingRegistry = makeMockRegistry({
        invoke: vi.fn().mockRejectedValue(new Error("fail")),
      });
      const failAgent = new ExecutorAgent(failingRegistry, memory, gemini);

      await failAgent.execute(validStep, validContext, 1);

      expect(memory.storeShortTerm).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // 5. selectTool fast path
  // -------------------------------------------------------------------------

  describe("selectTool fast path", () => {
    it("uses suggestedTool without calling Gemini when it is registered", async () => {
      await agent.execute(validStep, validContext, 1);

      // Gemini should not have been called at all
      expect(gemini.getGenerativeModel).not.toHaveBeenCalled();
    });

    it("uses the suggestedTool as toolUsed in the result", async () => {
      const result = await agent.execute(validStep, validContext, 1);
      expect(result.toolUsed).toBe("web_search");
    });

    it("falls back to Gemini when suggestedTool is null", async () => {
      const stepWithNoTool: IStepForExecution = {
        ...validStep,
        suggestedTool: null,
      };

      // getTool throws for the null path (no suggested tool), so Gemini is used
      const registryWithLLMFallback = makeMockRegistry({
        getTool: vi.fn().mockReturnValue({
          name: "web_search",
          description: "Search the web",
          inputSchema: {},
          outputSchema: {},
          execute: vi.fn(),
        }),
        listTools: vi.fn().mockReturnValue([
          { name: "web_search", description: "Search the web", inputSchema: {}, outputSchema: {} },
        ]),
        invoke: vi.fn().mockResolvedValue(successfulToolOutput),
      });

      const geminiForFallback = makeMockGemini();
      const fallbackAgent = new ExecutorAgent(registryWithLLMFallback, memory, geminiForFallback);

      await fallbackAgent.execute(stepWithNoTool, validContext, 1);

      // Gemini should have been called for tool selection
      expect(geminiForFallback.getGenerativeModel).toHaveBeenCalled();
    });
  });
});
