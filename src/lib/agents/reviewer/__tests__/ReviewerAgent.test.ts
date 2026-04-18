/**
 * Unit tests for ReviewerAgent.
 *
 * Tests cover:
 * - Accept path: Gemini returns accept → ReviewDecision has decision:"accept", reason string, confidence in [0,1]
 * - Schema validation failure: output doesn't match expectedOutputSchema → reject without calling Gemini
 * - Failure status: result.status === "failure" → reject immediately, Gemini not called
 * - Invalid decision value: Gemini returns unknown decision → defaults to "reject"
 * - Gemini error: Gemini throws → decision:"reject", reason contains error message
 * - Confidence clamping: Gemini returns confidence > 1 or < 0 → clamped to [0,1]
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { ReviewerAgent, type IStepForReview } from "../ReviewerAgent";
import type { IGeminiClient } from "../../executor/toolSelection";
import type { ExecutionResult } from "../../../../types";

// ---------------------------------------------------------------------------
// Mock factory
// ---------------------------------------------------------------------------

function makeMockGemini(responseJson: object): IGeminiClient {
  const generateContent = vi.fn().mockResolvedValue({
    response: { text: () => JSON.stringify(responseJson) },
  });
  return { getGenerativeModel: vi.fn().mockReturnValue({ generateContent }) };
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const validStep: IStepForReview = {
  description: "Fetch search results for AI news",
  expectedOutputSchema: {
    type: "object",
    properties: {
      results: { type: "array" },
    },
  },
};

function makeSuccessResult(output: unknown = { results: ["item1"] }): ExecutionResult {
  return {
    stepId: "step-1",
    toolUsed: "calculator",
    input: { expression: "1+1" },
    output,
    status: "success",
    logs: ["[2024-01-01T00:00:00.000Z] Attempt 1 — tool: calculator"],
    confidence: 0.9,
    createdAt: new Date(),
  };
}

function makeFailureResult(): ExecutionResult {
  return {
    stepId: "step-1",
    toolUsed: "web_search",
    input: { query: "AI news" },
    output: null,
    status: "failure",
    logs: ["[2024-01-01T00:00:00.000Z] Tool invocation failed"],
    confidence: 0,
    createdAt: new Date(),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ReviewerAgent", () => {
  // -------------------------------------------------------------------------
  // 1. Accept path
  // -------------------------------------------------------------------------

  describe("accept path", () => {
    it("returns decision:'accept' when Gemini returns accept", async () => {
      const gemini = makeMockGemini({
        decision: "accept",
        reason: "Output is relevant and matches the schema",
        confidence: 0.95,
      });
      const agent = new ReviewerAgent(gemini);

      const result = await agent.review(validStep, makeSuccessResult(), "Find AI news");

      expect(result.decision).toBe("accept");
    });

    it("returns a non-empty reason string on accept", async () => {
      const gemini = makeMockGemini({
        decision: "accept",
        reason: "Output is relevant and matches the schema",
        confidence: 0.95,
      });
      const agent = new ReviewerAgent(gemini);

      const result = await agent.review(validStep, makeSuccessResult(), "Find AI news");

      expect(typeof result.reason).toBe("string");
      expect(result.reason.length).toBeGreaterThan(0);
    });

    it("returns confidence in [0, 1] on accept", async () => {
      const gemini = makeMockGemini({
        decision: "accept",
        reason: "Looks good",
        confidence: 0.85,
      });
      const agent = new ReviewerAgent(gemini);

      const result = await agent.review(validStep, makeSuccessResult(), "Find AI news");

      expect(result.confidence).toBeGreaterThanOrEqual(0);
      expect(result.confidence).toBeLessThanOrEqual(1);
    });

    it("passes the Gemini confidence value through when it is in range", async () => {
      const gemini = makeMockGemini({
        decision: "accept",
        reason: "Looks good",
        confidence: 0.75,
      });
      const agent = new ReviewerAgent(gemini);

      const result = await agent.review(validStep, makeSuccessResult(), "Find AI news");

      expect(result.confidence).toBe(0.75);
    });
  });

  // -------------------------------------------------------------------------
  // 2. Schema validation failure
  // -------------------------------------------------------------------------

  describe("schema validation failure", () => {
    it("returns decision:'reject' when output doesn't match expectedOutputSchema", async () => {
      const stepWithStrictSchema: IStepForReview = {
        description: "Get a number",
        expectedOutputSchema: {
          type: "number",
        },
      };
      // output is an object, but schema expects a number
      const result = makeSuccessResult({ results: ["item1"] });

      const gemini = makeMockGemini({ decision: "accept", reason: "ok", confidence: 1 });
      const agent = new ReviewerAgent(gemini);

      const decision = await agent.review(stepWithStrictSchema, result, "Get a number");

      expect(decision.decision).toBe("reject");
    });

    it("does not call Gemini when schema validation fails", async () => {
      const stepWithStrictSchema: IStepForReview = {
        description: "Get a number",
        expectedOutputSchema: {
          type: "number",
        },
      };
      const result = makeSuccessResult({ results: ["item1"] });

      const gemini = makeMockGemini({ decision: "accept", reason: "ok", confidence: 1 });
      const agent = new ReviewerAgent(gemini);

      await agent.review(stepWithStrictSchema, result, "Get a number");

      expect(gemini.getGenerativeModel).not.toHaveBeenCalled();
    });

    it("includes schema mismatch info in the reason", async () => {
      const stepWithStrictSchema: IStepForReview = {
        description: "Get a number",
        expectedOutputSchema: { type: "number" },
      };
      const result = makeSuccessResult({ results: ["item1"] });

      const gemini = makeMockGemini({ decision: "accept", reason: "ok", confidence: 1 });
      const agent = new ReviewerAgent(gemini);

      const decision = await agent.review(stepWithStrictSchema, result, "Get a number");

      expect(decision.reason.toLowerCase()).toMatch(/schema|expected/);
    });
  });

  // -------------------------------------------------------------------------
  // 3. Failure status
  // -------------------------------------------------------------------------

  describe("failure status", () => {
    it("returns decision:'reject' immediately when result.status is 'failure'", async () => {
      const gemini = makeMockGemini({ decision: "accept", reason: "ok", confidence: 1 });
      const agent = new ReviewerAgent(gemini);

      const decision = await agent.review(validStep, makeFailureResult(), "Find AI news");

      expect(decision.decision).toBe("reject");
    });

    it("does not call Gemini when result.status is 'failure'", async () => {
      const gemini = makeMockGemini({ decision: "accept", reason: "ok", confidence: 1 });
      const agent = new ReviewerAgent(gemini);

      await agent.review(validStep, makeFailureResult(), "Find AI news");

      expect(gemini.getGenerativeModel).not.toHaveBeenCalled();
    });

    it("returns confidence:0 when result.status is 'failure'", async () => {
      const gemini = makeMockGemini({ decision: "accept", reason: "ok", confidence: 1 });
      const agent = new ReviewerAgent(gemini);

      const decision = await agent.review(validStep, makeFailureResult(), "Find AI news");

      expect(decision.confidence).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  // 4. Invalid decision value defaults to "reject"
  // -------------------------------------------------------------------------

  describe("invalid decision value", () => {
    it("defaults to 'reject' when Gemini returns an unrecognised decision value", async () => {
      const gemini = makeMockGemini({
        decision: "maybe",
        reason: "Not sure",
        confidence: 0.5,
      });
      const agent = new ReviewerAgent(gemini);

      const decision = await agent.review(validStep, makeSuccessResult(), "Find AI news");

      expect(decision.decision).toBe("reject");
    });

    it("defaults to 'reject' when Gemini returns a numeric decision", async () => {
      const gemini = makeMockGemini({
        decision: 1,
        reason: "Numeric decision",
        confidence: 0.5,
      });
      const agent = new ReviewerAgent(gemini);

      const decision = await agent.review(validStep, makeSuccessResult(), "Find AI news");

      expect(decision.decision).toBe("reject");
    });

    it("decision is always 'accept' or 'reject', never anything else", async () => {
      const gemini = makeMockGemini({
        decision: "unknown_value",
        reason: "Some reason",
        confidence: 0.5,
      });
      const agent = new ReviewerAgent(gemini);

      const decision = await agent.review(validStep, makeSuccessResult(), "Find AI news");

      expect(["accept", "reject"]).toContain(decision.decision);
    });
  });

  // -------------------------------------------------------------------------
  // 5. Gemini error
  // -------------------------------------------------------------------------

  describe("Gemini error", () => {
    it("returns decision:'reject' when Gemini throws", async () => {
      const generateContent = vi.fn().mockRejectedValue(new Error("Network timeout"));
      const gemini: IGeminiClient = {
        getGenerativeModel: vi.fn().mockReturnValue({ generateContent }),
      };
      const agent = new ReviewerAgent(gemini);

      const decision = await agent.review(validStep, makeSuccessResult(), "Find AI news");

      expect(decision.decision).toBe("reject");
    });

    it("includes the error message in the reason when Gemini throws", async () => {
      const generateContent = vi.fn().mockRejectedValue(new Error("Network timeout"));
      const gemini: IGeminiClient = {
        getGenerativeModel: vi.fn().mockReturnValue({ generateContent }),
      };
      const agent = new ReviewerAgent(gemini);

      const decision = await agent.review(validStep, makeSuccessResult(), "Find AI news");

      expect(decision.reason).toContain("Network timeout");
    });

    it("never throws — always returns a ReviewDecision even when Gemini errors", async () => {
      const generateContent = vi.fn().mockRejectedValue(new Error("Catastrophic failure"));
      const gemini: IGeminiClient = {
        getGenerativeModel: vi.fn().mockReturnValue({ generateContent }),
      };
      const agent = new ReviewerAgent(gemini);

      await expect(
        agent.review(validStep, makeSuccessResult(), "Find AI news")
      ).resolves.toBeDefined();
    });
  });

  // -------------------------------------------------------------------------
  // 6. Confidence clamping
  // -------------------------------------------------------------------------

  describe("confidence clamping", () => {
    it("clamps confidence > 1 down to 1", async () => {
      const gemini = makeMockGemini({
        decision: "accept",
        reason: "Very confident",
        confidence: 1.5,
      });
      const agent = new ReviewerAgent(gemini);

      const decision = await agent.review(validStep, makeSuccessResult(), "Find AI news");

      expect(decision.confidence).toBe(1);
    });

    it("clamps confidence < 0 up to 0", async () => {
      const gemini = makeMockGemini({
        decision: "reject",
        reason: "Not confident at all",
        confidence: -0.3,
      });
      const agent = new ReviewerAgent(gemini);

      const decision = await agent.review(validStep, makeSuccessResult(), "Find AI news");

      expect(decision.confidence).toBe(0);
    });

    it("does not alter confidence that is exactly 0", async () => {
      const gemini = makeMockGemini({
        decision: "reject",
        reason: "Zero confidence",
        confidence: 0,
      });
      const agent = new ReviewerAgent(gemini);

      const decision = await agent.review(validStep, makeSuccessResult(), "Find AI news");

      expect(decision.confidence).toBe(0);
    });

    it("does not alter confidence that is exactly 1", async () => {
      const gemini = makeMockGemini({
        decision: "accept",
        reason: "Full confidence",
        confidence: 1,
      });
      const agent = new ReviewerAgent(gemini);

      const decision = await agent.review(validStep, makeSuccessResult(), "Find AI news");

      expect(decision.confidence).toBe(1);
    });

    it("clamps extreme positive confidence values", async () => {
      const gemini = makeMockGemini({
        decision: "accept",
        reason: "Extreme confidence",
        confidence: 999,
      });
      const agent = new ReviewerAgent(gemini);

      const decision = await agent.review(validStep, makeSuccessResult(), "Find AI news");

      expect(decision.confidence).toBeLessThanOrEqual(1);
    });

    it("clamps extreme negative confidence values", async () => {
      const gemini = makeMockGemini({
        decision: "reject",
        reason: "Extreme negative",
        confidence: -999,
      });
      const agent = new ReviewerAgent(gemini);

      const decision = await agent.review(validStep, makeSuccessResult(), "Find AI news");

      expect(decision.confidence).toBeGreaterThanOrEqual(0);
    });
  });
});
