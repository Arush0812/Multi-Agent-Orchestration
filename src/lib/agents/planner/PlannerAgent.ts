/**
 * PlannerAgent — decomposes a high-level user query into ordered, atomic steps.
 *
 * Calls OpenAI gpt-4o with a structured JSON prompt, then validates and
 * normalises the response into a `PlannedStep[]` via `validateAndNormalizePlan`.
 */

import type OpenAI from "openai";
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
// Implementation
// ---------------------------------------------------------------------------

export class PlannerAgent implements IPlannerAgent {
  private openai: OpenAI;
  private memory: IMemorySystem;

  /**
   * @param openai  - Injected OpenAI client (not created internally for testability)
   * @param memory  - MemorySystem used to retrieve relevant prior context
   */
  constructor(openai: OpenAI, memory: IMemorySystem) {
    this.openai = openai;
    this.memory = memory;
  }

  /**
   * Decompose `query` into an ordered array of atomic `PlannedStep`s.
   *
   * 1. Builds system + user prompts from the provided context.
   * 2. Calls OpenAI gpt-4o with `response_format: { type: "json_object" }`.
   * 3. Parses the JSON response.
   * 4. Validates and normalises via `validateAndNormalizePlan`.
   *
   * @throws The raw OpenAI error if the API call fails (caller handles retry).
   * @throws `PlanValidationError` if the LLM response cannot be parsed or
   *   fails schema validation.
   */
  async plan(query: string, context: PlannerContext): Promise<PlannedStep[]> {
    const systemPrompt = buildPlannerSystemPrompt();
    const userPrompt = buildPlannerUserPrompt(query, context.relevantMemory);

    const response = await this.openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      response_format: { type: "json_object" },
    });

    const content = response.choices[0].message.content;
    const parsed: unknown = JSON.parse(content!);

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
 * The returned object satisfies `IPlannerAgent`: callers pass only the raw
 * `query` string; context is built internally by calling
 * `memory.retrieveRelevant(query, 5)`.
 *
 * @param openai  - Injected OpenAI client
 * @param memory  - MemorySystem instance
 */
export function createPlannerAgent(
  openai: OpenAI,
  memory: IMemorySystem
): IPlannerAgent {
  const agent = new PlannerAgent(openai, memory);

  return {
    async plan(query: string, context?: PlannerContext): Promise<PlannedStep[]> {
      const resolvedContext: PlannerContext = context ?? {
        relevantMemory: await memory.retrieveRelevant(query, 5),
      };
      return agent.plan(query, resolvedContext);
    },
  };
}
