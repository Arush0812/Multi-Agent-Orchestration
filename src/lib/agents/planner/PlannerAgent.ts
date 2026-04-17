/**
 * PlannerAgent — decomposes a high-level user query into ordered, atomic steps.
 *
 * Calls Gemini gemini-1.5-pro with a structured JSON prompt, then validates and
 * normalises the response into a `PlannedStep[]` via `validateAndNormalizePlan`.
 */

import type { GenerativeModel } from "@google/generative-ai";
import type { IMemorySystem } from "../../memory/MemorySystem";
import type { PlannedStep, PlannerContext } from "../../../types";
import { buildPlannerSystemPrompt, buildPlannerUserPrompt } from "./prompts";
import { validateAndNormalizePlan } from "./validation";

// ---------------------------------------------------------------------------
// PlannerAgent interface (mirrors design.md)
// ---------------------------------------------------------------------------

export interface IPlannerAgent {
  plan(query: string, context: PlannerContext): Promise<PlannedStep[]>;
}

// ---------------------------------------------------------------------------
// Gemini client interface (for testability)
// ---------------------------------------------------------------------------

export interface IGeminiClient {
  getGenerativeModel(params: { model: string; generationConfig?: Record<string, unknown> }): GenerativeModel;
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

export class PlannerAgent implements IPlannerAgent {
  private gemini: IGeminiClient;
  private memory: IMemorySystem;

  /**
   * @param gemini  - Injected Gemini client (GoogleGenerativeAI instance)
   * @param memory  - MemorySystem used to retrieve relevant prior context
   */
  constructor(gemini: IGeminiClient, memory: IMemorySystem) {
    this.gemini = gemini;
    this.memory = memory;
  }

  /**
   * Decompose `query` into an ordered array of atomic `PlannedStep`s.
   *
   * 1. Builds system + user prompts from the provided context.
   * 2. Calls Gemini gemini-1.5-pro with responseMimeType: "application/json".
   * 3. Parses the JSON response.
   * 4. Validates and normalises via `validateAndNormalizePlan`.
   *
   * @throws The raw Gemini error if the API call fails (caller handles retry).
   * @throws `PlanValidationError` if the LLM response cannot be parsed or
   *   fails schema validation.
   */
  async plan(query: string, context: PlannerContext): Promise<PlannedStep[]> {
    const systemPrompt = buildPlannerSystemPrompt();
    const userPrompt = buildPlannerUserPrompt(query, context.relevantMemory);

    const model = this.gemini.getGenerativeModel({
      model: "gemini-2.0-flash",
      generationConfig: {
        responseMimeType: "application/json",
      },
    });

    const result = await model.generateContent([
      { text: systemPrompt },
      { text: userPrompt },
    ]);

    const content = result.response.text();
    const parsed: unknown = JSON.parse(content);

    return validateAndNormalizePlan(parsed);
  }
}

// ---------------------------------------------------------------------------
// Convenience factory used by the Orchestrator
// ---------------------------------------------------------------------------

/**
 * Creates a `PlannerAgent` and wraps its `plan` method so that relevant
 * memory is automatically retrieved before planning.
 *
 * @param gemini  - Injected Gemini client (GoogleGenerativeAI instance)
 * @param memory  - MemorySystem instance
 */
export function createPlannerAgent(
  gemini: IGeminiClient,
  memory: IMemorySystem
): IPlannerAgent {
  const agent = new PlannerAgent(gemini, memory);

  return {
    async plan(query: string, context?: PlannerContext): Promise<PlannedStep[]> {
      const resolvedContext: PlannerContext = context ?? {
        relevantMemory: await memory.retrieveRelevant(query, 5),
      };
      return agent.plan(query, resolvedContext);
    },
  };
}
