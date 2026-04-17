/**
 * Unit tests for PlannerAgent.
 *
 * Tests cover:
 * - Happy path: valid LLM response → correct PlannedStep[] structure and ordering
 * - Malformed response: invalid JSON content → PlanValidationError thrown
 * - Memory context in prompt: memory chunks are included in the user prompt
 * - Empty memory: plan still works when no memory chunks are returned
 * - Gemini error propagation: API errors bubble up to the caller
 */

import { describe, it, expect, vi } from "vitest";
import { PlannerAgent, type IGeminiClient } from "../PlannerAgent";
import { PlanValidationError, type MemoryChunk, type PlannerContext } from "../../../../types";
import type { IMemorySystem } from "../../../memory/MemorySystem";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a minimal mock Gemini client whose generateContent is a vi.fn(). */
function makeMockGemini(responseContent: string) {
  const generateContent = vi.fn().mockResolvedValue({
    response: { text: () => responseContent },
  });

  const getGenerativeModel = vi.fn().mockReturnValue({ generateContent });

  return {
    getGenerativeModel,
    _generateContent: generateContent,
  } as unknown as IGeminiClient & { _generateContent: ReturnType<typeof vi.fn> };
}

/** Build a minimal mock IMemorySystem. */
function makeMockMemory(chunks: MemoryChunk[] = []): IMemorySystem {
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
      const mock = makeMockGemini(validResponseContent([validStep(1)]));
      const memory = makeMockMemory();
      const agent = new PlannerAgent(mock, memory);

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
      const steps = [validStep(3), validStep(1), validStep(2)];
      const mock = makeMockGemini(validResponseContent(steps));
      const memory = makeMockMemory();
      const agent = new PlannerAgent(mock, memory);

      const result = await agent.plan("test query", emptyContext);

      expect(result).toHaveLength(3);
      expect(result.map((s) => s.order)).toEqual([1, 2, 3]);
    });

    it("returns steps with all required fields populated", async () => {
      const steps = [
        { order: 1, description: "Search for data", suggestedTool: "web_search" as const, expectedOutputSchema: { type: "object" } },
        { order: 2, description: "Calculate average", suggestedTool: "calculator" as const, expectedOutputSchema: { type: "object" } },
        { order: 3, description: "Summarise findings", suggestedTool: null, expectedOutputSchema: { type: "object" } },
      ];
      const mock = makeMockGemini(validResponseContent(steps));
      const memory = makeMockMemory();
      const agent = new PlannerAgent(mock, memory);

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
      const mock = makeMockGemini(JSON.stringify({ result: [] }));
      const memory = makeMockMemory();
      const agent = new PlannerAgent(mock, memory);

      await expect(agent.plan("query", emptyContext)).rejects.toThrow(PlanValidationError);
    });

    it("throws PlanValidationError when 'steps' is an empty array", async () => {
      const mock = makeMockGemini(JSON.stringify({ steps: [] }));
      const memory = makeMockMemory();
      const agent = new PlannerAgent(mock, memory);

      await expect(agent.plan("query", emptyContext)).rejects.toThrow(PlanValidationError);
    });

    it("throws PlanValidationError when a step is missing 'description'", async () => {
      const badStep = { order: 1, suggestedTool: "web_search", expectedOutputSchema: {} };
      const mock = makeMockGemini(JSON.stringify({ steps: [badStep] }));
      const memory = makeMockMemory();
      const agent = new PlannerAgent(mock, memory);

      await expect(agent.plan("query", emptyContext)).rejects.toThrow(PlanValidationError);
    });

    it("throws PlanValidationError when steps have duplicate order values", async () => {
      const steps = [validStep(1), { ...validStep(1), description: "duplicate order" }];
      const mock = makeMockGemini(JSON.stringify({ steps }));
      const memory = makeMockMemory();
      const agent = new PlannerAgent(mock, memory);

      await expect(agent.plan("query", emptyContext)).rejects.toThrow(PlanValidationError);
    });

    it("throws PlanValidationError when step orders are non-contiguous (gap)", async () => {
      const steps = [validStep(1), validStep(3)];
      const mock = makeMockGemini(JSON.stringify({ steps }));
      const memory = makeMockMemory();
      const agent = new PlannerAgent(mock, memory);

      await expect(agent.plan("query", emptyContext)).rejects.toThrow(PlanValidationError);
    });

    it("attaches the raw response to the thrown PlanValidationError", async () => {
      const rawPayload = { steps: [] };
      const mock = makeMockGemini(JSON.stringify(rawPayload));
      const memory = makeMockMemory();
      const agent = new PlannerAgent(mock, memory);

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
    it("includes memory chunk content in the prompt sent to Gemini", async () => {
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

      const mock = makeMockGemini(validResponseContent([validStep(1)]));
      const memory = makeMockMemory(chunks);
      const agent = new PlannerAgent(mock, memory);

      const context: PlannerContext = { relevantMemory: chunks };
      await agent.plan("my query", context);

      // Inspect the content parts passed to Gemini
      const callArgs = mock._generateContent.mock.calls[0][0] as Array<{ text: string }>;
      const allText = callArgs.map((p) => p.text).join("\n");

      expect(allText).toContain("Previous task found that the answer is 42");
      expect(allText).toContain("Step output: search returned 10 results");
    });

    it("includes the original query in the prompt", async () => {
      const mock = makeMockGemini(validResponseContent([validStep(1)]));
      const memory = makeMockMemory();
      const agent = new PlannerAgent(mock, memory);

      await agent.plan("find the best pizza in Rome", emptyContext);

      const callArgs = mock._generateContent.mock.calls[0][0] as Array<{ text: string }>;
      const allText = callArgs.map((p) => p.text).join("\n");

      expect(allText).toContain("find the best pizza in Rome");
    });

    it("sends both system and user content to Gemini", async () => {
      const mock = makeMockGemini(validResponseContent([validStep(1)]));
      const memory = makeMockMemory();
      const agent = new PlannerAgent(mock, memory);

      await agent.plan("query", emptyContext);

      const callArgs = mock._generateContent.mock.calls[0][0] as Array<{ text: string }>;
      expect(callArgs.length).toBeGreaterThanOrEqual(2);
      expect(callArgs[0].text.length).toBeGreaterThan(0);
      expect(callArgs[1].text.length).toBeGreaterThan(0);
    });
  });

  // -------------------------------------------------------------------------

  describe("empty memory", () => {
    it("returns a valid plan when memory returns []", async () => {
      const mock = makeMockGemini(validResponseContent([validStep(1), validStep(2)]));
      const memory = makeMockMemory([]);
      const agent = new PlannerAgent(mock, memory);

      const result = await agent.plan("query with no memory", emptyContext);

      expect(result).toHaveLength(2);
      expect(result[0].order).toBe(1);
      expect(result[1].order).toBe(2);
    });
  });

  // -------------------------------------------------------------------------

  describe("Gemini error propagation", () => {
    it("propagates errors thrown by Gemini generateContent", async () => {
      const apiError = new Error("Gemini API rate limit exceeded");
      const generateContent = vi.fn().mockRejectedValue(apiError);
      const mockGemini = {
        getGenerativeModel: vi.fn().mockReturnValue({ generateContent }),
      } as unknown as IGeminiClient;
      const memory = makeMockMemory();
      const agent = new PlannerAgent(mockGemini, memory);

      await expect(agent.plan("query", emptyContext)).rejects.toThrow("Gemini API rate limit exceeded");
    });

    it("propagates network errors from Gemini", async () => {
      const networkError = new Error("ECONNREFUSED");
      const generateContent = vi.fn().mockRejectedValue(networkError);
      const mockGemini = {
        getGenerativeModel: vi.fn().mockReturnValue({ generateContent }),
      } as unknown as IGeminiClient;
      const memory = makeMockMemory();
      const agent = new PlannerAgent(mockGemini, memory);

      await expect(agent.plan("query", emptyContext)).rejects.toThrow("ECONNREFUSED");
    });
  });
});
