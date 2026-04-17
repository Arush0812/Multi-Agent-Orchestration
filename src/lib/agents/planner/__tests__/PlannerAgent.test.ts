/**
 * Unit tests for PlannerAgent.
 *
 * Tests cover:
 * - Happy path: valid LLM response → correct PlannedStep[] structure and ordering
 * - Malformed response: invalid JSON content → PlanValidationError thrown
 * - Memory context in prompt: memory chunks are included in the user prompt
 * - Empty memory: plan still works when no memory chunks are returned
 * - OpenAI error propagation: API errors bubble up to the caller
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { PlannerAgent } from "../PlannerAgent";
import { PlanValidationError, type MemoryChunk, type PlannerContext } from "../../../../types";
import type { IMemorySystem } from "../../memory/MemorySystem";
import type OpenAI from "openai";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a minimal mock OpenAI client whose chat.completions.create is a vi.fn(). */
function makeMockOpenAI(responseContent: string) {
  const create = vi.fn().mockResolvedValue({
    choices: [
      {
        message: {
          content: responseContent,
        },
      },
    ],
  });

  return {
    chat: {
      completions: { create },
    },
    // Capture the mock so tests can inspect calls
    _create: create,
  };
}

/** Build a minimal mock IMemorySystem. */
function makeMockMemory(chunks: MemoryChunk[] = []): IMemorySystem & { retrieveRelevant: ReturnType<typeof vi.fn> } {
  return {
    retrieveRelevant: vi.fn().mockResolvedValue(chunks),
    storeShortTerm: vi.fn(),
    getShortTerm: vi.fn(),
    storeLongTerm: vi.fn(),
  };
}

/** A valid step payload for use in mock responses. */
const validStep = (order: number) => ({
  order,
  description: `Step ${order} description`,
  suggestedTool: "web_search" as const,
  expectedOutputSchema: { type: "object" },
});

/** Build a valid LLM response JSON string with the given steps. */
function validResponseContent(steps: ReturnType<typeof validStep>[]) {
  return JSON.stringify({ steps });
}

/** Build a minimal PlannerContext with no memory. */
const emptyContext: PlannerContext = { relevantMemory: [] };

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("PlannerAgent", () => {
  describe("happy path — valid LLM response", () => {
    it("returns a PlannedStep[] with correct structure for a single step", async () => {
      const mock = makeMockOpenAI(validResponseContent([validStep(1)]));
      const memory = makeMockMemory();
      const agent = new PlannerAgent(mock as unknown as OpenAI, memory);

      const result = await agent.plan("test query", emptyContext);

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        order: 1,
        description: "Step 1 description",
        suggestedTool: "web_search",
        expectedOutputSchema: { type: "object" },
      });
    });

    it("returns steps sorted by order ascending when LLM returns them out of order", async () => {
      // LLM returns steps in reverse order: 3, 1, 2
      const steps = [validStep(3), validStep(1), validStep(2)];
      const mock = makeMockOpenAI(validResponseContent(steps));
      const memory = makeMockMemory();
      const agent = new PlannerAgent(mock as unknown as OpenAI, memory);

      const result = await agent.plan("test query", emptyContext);

      expect(result).toHaveLength(3);
      expect(result.map((s) => s.order)).toEqual([1, 2, 3]);
    });

    it("returns steps with all required fields populated", async () => {
      const steps = [
        { order: 1, description: "Search for data", suggestedTool: "web_search" as const, expectedOutputSchema: { type: "object", properties: { results: { type: "array" } } } },
        { order: 2, description: "Calculate average", suggestedTool: "calculator" as const, expectedOutputSchema: { type: "object" } },
        { order: 3, description: "Summarise findings", suggestedTool: null, expectedOutputSchema: { type: "object" } },
      ];
      const mock = makeMockOpenAI(validResponseContent(steps));
      const memory = makeMockMemory();
      const agent = new PlannerAgent(mock as unknown as OpenAI, memory);

      const result = await agent.plan("research query", emptyContext);

      expect(result).toHaveLength(3);
      expect(result[0].suggestedTool).toBe("web_search");
      expect(result[1].suggestedTool).toBe("calculator");
      expect(result[2].suggestedTool).toBeNull();
    });
  });

  // -------------------------------------------------------------------------

  describe("malformed LLM response → PlanValidationError", () => {
    it("throws PlanValidationError when response is missing the 'steps' key", async () => {
      const mock = makeMockOpenAI(JSON.stringify({ result: [] }));
      const memory = makeMockMemory();
      const agent = new PlannerAgent(mock as unknown as OpenAI, memory);

      await expect(agent.plan("query", emptyContext)).rejects.toThrow(PlanValidationError);
    });

    it("throws PlanValidationError when 'steps' is an empty array", async () => {
      const mock = makeMockOpenAI(JSON.stringify({ steps: [] }));
      const memory = makeMockMemory();
      const agent = new PlannerAgent(mock as unknown as OpenAI, memory);

      await expect(agent.plan("query", emptyContext)).rejects.toThrow(PlanValidationError);
    });

    it("throws PlanValidationError when a step is missing 'description'", async () => {
      const badStep = { order: 1, suggestedTool: "web_search", expectedOutputSchema: {} };
      const mock = makeMockOpenAI(JSON.stringify({ steps: [badStep] }));
      const memory = makeMockMemory();
      const agent = new PlannerAgent(mock as unknown as OpenAI, memory);

      await expect(agent.plan("query", emptyContext)).rejects.toThrow(PlanValidationError);
    });

    it("throws PlanValidationError when step 'order' is not a positive integer", async () => {
      const badStep = { order: -1, description: "bad step", suggestedTool: null, expectedOutputSchema: {} };
      const mock = makeMockOpenAI(JSON.stringify({ steps: [badStep] }));
      const memory = makeMockMemory();
      const agent = new PlannerAgent(mock as unknown as OpenAI, memory);

      await expect(agent.plan("query", emptyContext)).rejects.toThrow(PlanValidationError);
    });

    it("throws PlanValidationError when steps have duplicate order values", async () => {
      const steps = [validStep(1), { ...validStep(1), description: "duplicate order" }];
      const mock = makeMockOpenAI(JSON.stringify({ steps }));
      const memory = makeMockMemory();
      const agent = new PlannerAgent(mock as unknown as OpenAI, memory);

      await expect(agent.plan("query", emptyContext)).rejects.toThrow(PlanValidationError);
    });

    it("throws PlanValidationError when step orders are non-contiguous (gap)", async () => {
      const steps = [validStep(1), validStep(3)]; // missing order 2
      const mock = makeMockOpenAI(JSON.stringify({ steps }));
      const memory = makeMockMemory();
      const agent = new PlannerAgent(mock as unknown as OpenAI, memory);

      await expect(agent.plan("query", emptyContext)).rejects.toThrow(PlanValidationError);
    });

    it("attaches the raw response to the thrown PlanValidationError", async () => {
      const rawPayload = { steps: [] };
      const mock = makeMockOpenAI(JSON.stringify(rawPayload));
      const memory = makeMockMemory();
      const agent = new PlannerAgent(mock as unknown as OpenAI, memory);

      let caught: unknown;
      try {
        await agent.plan("query", emptyContext);
      } catch (err) {
        caught = err;
      }

      expect(caught).toBeInstanceOf(PlanValidationError);
      expect((caught as PlanValidationError).rawResponse).toEqual(rawPayload);
    });
  });

  // -------------------------------------------------------------------------

  describe("memory context included in prompt", () => {
    it("includes memory chunk content in the user prompt sent to OpenAI", async () => {
      const chunks: MemoryChunk[] = [
        {
          content: "Previous task found that the answer is 42",
          metadata: { taskId: "task-1", type: "task_result", createdAt: new Date() },
          score: 0.9,
        },
        {
          content: "Step output: search returned 10 results",
          metadata: { taskId: "task-1", stepId: "step-1", type: "step_output", createdAt: new Date() },
          score: 0.8,
        },
      ];

      const mock = makeMockOpenAI(validResponseContent([validStep(1)]));
      const memory = makeMockMemory(chunks);
      const agent = new PlannerAgent(mock as unknown as OpenAI, memory);

      const context: PlannerContext = { relevantMemory: chunks };
      await agent.plan("my query", context);

      // Inspect the messages passed to OpenAI
      const callArgs = mock._create.mock.calls[0][0] as { messages: Array<{ role: string; content: string }> };
      const userMessage = callArgs.messages.find((m) => m.role === "user");

      expect(userMessage).toBeDefined();
      expect(userMessage!.content).toContain("Previous task found that the answer is 42");
      expect(userMessage!.content).toContain("Step output: search returned 10 results");
    });

    it("includes the original query in the user prompt", async () => {
      const mock = makeMockOpenAI(validResponseContent([validStep(1)]));
      const memory = makeMockMemory();
      const agent = new PlannerAgent(mock as unknown as OpenAI, memory);

      await agent.plan("find the best pizza in Rome", emptyContext);

      const callArgs = mock._create.mock.calls[0][0] as { messages: Array<{ role: string; content: string }> };
      const userMessage = callArgs.messages.find((m) => m.role === "user");

      expect(userMessage!.content).toContain("find the best pizza in Rome");
    });

    it("sends a system message alongside the user message", async () => {
      const mock = makeMockOpenAI(validResponseContent([validStep(1)]));
      const memory = makeMockMemory();
      const agent = new PlannerAgent(mock as unknown as OpenAI, memory);

      await agent.plan("query", emptyContext);

      const callArgs = mock._create.mock.calls[0][0] as { messages: Array<{ role: string; content: string }> };
      const systemMessage = callArgs.messages.find((m) => m.role === "system");

      expect(systemMessage).toBeDefined();
      expect(systemMessage!.content.length).toBeGreaterThan(0);
    });
  });

  // -------------------------------------------------------------------------

  describe("empty memory", () => {
    it("returns a valid plan when memory.retrieveRelevant returns []", async () => {
      const mock = makeMockOpenAI(validResponseContent([validStep(1), validStep(2)]));
      const memory = makeMockMemory([]);
      const agent = new PlannerAgent(mock as unknown as OpenAI, memory);

      const context: PlannerContext = { relevantMemory: [] };
      const result = await agent.plan("query with no memory", context);

      expect(result).toHaveLength(2);
      expect(result[0].order).toBe(1);
      expect(result[1].order).toBe(2);
    });

    it("does not include a memory context section in the prompt when chunks are empty", async () => {
      const mock = makeMockOpenAI(validResponseContent([validStep(1)]));
      const memory = makeMockMemory([]);
      const agent = new PlannerAgent(mock as unknown as OpenAI, memory);

      const context: PlannerContext = { relevantMemory: [] };
      await agent.plan("query", context);

      const callArgs = mock._create.mock.calls[0][0] as { messages: Array<{ role: string; content: string }> };
      const userMessage = callArgs.messages.find((m) => m.role === "user");

      // The "Relevant Context" section should not appear when there are no chunks
      expect(userMessage!.content).not.toContain("Relevant Context from Previous Tasks");
    });
  });

  // -------------------------------------------------------------------------

  describe("OpenAI error propagation", () => {
    it("propagates errors thrown by openai.chat.completions.create", async () => {
      const apiError = new Error("OpenAI API rate limit exceeded");
      const create = vi.fn().mockRejectedValue(apiError);
      const mockOpenAI = { chat: { completions: { create } } } as unknown as OpenAI;
      const memory = makeMockMemory();
      const agent = new PlannerAgent(mockOpenAI, memory);

      await expect(agent.plan("query", emptyContext)).rejects.toThrow("OpenAI API rate limit exceeded");
    });

    it("propagates network errors from OpenAI", async () => {
      const networkError = new Error("ECONNREFUSED");
      const create = vi.fn().mockRejectedValue(networkError);
      const mockOpenAI = { chat: { completions: { create } } } as unknown as OpenAI;
      const memory = makeMockMemory();
      const agent = new PlannerAgent(mockOpenAI, memory);

      await expect(agent.plan("query", emptyContext)).rejects.toThrow("ECONNREFUSED");
    });
  });
});
