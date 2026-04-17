/**
 * selectTool — determines which tool to use for a given step.
 *
 * Fast path: if `step.suggestedTool` is set and registered in the registry,
 * return it immediately without calling the LLM.
 *
 * LLM fallback: call Gemini gemini-1.5-flash with the step description and
 * the list of available tools; parse `{ toolName }` from the JSON response.
 * Assert the returned tool name is registered before returning.
 */

import type { ToolName, ExecutionContext } from "../../../types";
import type { IToolRegistry } from "../../tools/ToolRegistry";

// ---------------------------------------------------------------------------
// Minimal step interface (avoids coupling to Mongoose Document)
// ---------------------------------------------------------------------------

export interface IStepForSelection {
  suggestedTool: ToolName | null;
  description: string;
}

// ---------------------------------------------------------------------------
// Gemini client interface (mirrors PlannerAgent pattern)
// ---------------------------------------------------------------------------

export interface IGeminiClient {
  getGenerativeModel(params: {
    model: string;
    generationConfig?: Record<string, unknown>;
  }): {
    generateContent(
      parts: Array<{ text: string }>
    ): Promise<{ response: { text(): string } }>;
  };
}

// ---------------------------------------------------------------------------
// Prompt builder
// ---------------------------------------------------------------------------

function buildToolSelectionPrompt(
  stepDescription: string,
  tools: Array<{ name: string; description: string }>
): string {
  const toolList = tools
    .map((t) => `- ${t.name}: ${t.description}`)
    .join("\n");

  return [
    "You are a tool selection assistant. Given a step description and a list of available tools,",
    "select the most appropriate tool for the step.",
    "",
    "Available tools:",
    toolList,
    "",
    `Step description: ${stepDescription}`,
    "",
    'Respond with a JSON object in the format: { "toolName": "<tool_name>" }',
    "Only use a tool name from the list above.",
  ].join("\n");
}

// ---------------------------------------------------------------------------
// selectTool
// ---------------------------------------------------------------------------

/**
 * Select the best tool for `step`.
 *
 * @param step     - The step to select a tool for (needs `suggestedTool` and `description`).
 * @param context  - Current execution context (available for future prompt enrichment).
 * @param registry - Tool registry used to validate tool names.
 * @param gemini   - Gemini client used for LLM-based fallback selection.
 *
 * @returns The selected `ToolName`.
 *
 * @throws {Error} if the LLM returns a tool name that is not registered.
 */
export async function selectTool(
  step: IStepForSelection,
  context: ExecutionContext,
  registry: IToolRegistry,
  gemini: IGeminiClient
): Promise<ToolName> {
  // Fast path: use the suggested tool if it is registered
  if (step.suggestedTool !== null && step.suggestedTool !== undefined) {
    try {
      registry.getTool(step.suggestedTool);
      return step.suggestedTool;
    } catch {
      // suggestedTool is not registered — fall through to LLM selection
    }
  }

  // LLM fallback: ask Gemini to pick the best tool
  const availableTools = registry.listTools();
  const prompt = buildToolSelectionPrompt(step.description, availableTools);

  const model = gemini.getGenerativeModel({
    model: "gemini-1.5-flash",
    generationConfig: {
      responseMimeType: "application/json",
    },
  });

  const result = await model.generateContent([{ text: prompt }]);
  const text = result.response.text();

  let toolName: string;
  try {
    const parsed = JSON.parse(text) as { toolName?: unknown };
    if (typeof parsed.toolName !== "string" || parsed.toolName.trim() === "") {
      throw new Error(`Missing or invalid "toolName" field in LLM response`);
    }
    toolName = parsed.toolName.trim();
  } catch (err) {
    throw new Error(
      `Failed to parse tool selection response from Gemini: ${err instanceof Error ? err.message : String(err)}. Raw response: ${text}`
    );
  }

  // Assert the selected tool is registered
  registry.getTool(toolName as ToolName); // throws if not registered

  // Suppress unused variable warning — context is available for future use
  void context;

  return toolName as ToolName;
}
