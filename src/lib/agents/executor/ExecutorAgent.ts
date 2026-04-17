/**
 * ExecutorAgent — executes a single step by selecting and invoking the
 * appropriate tool, then returns a structured ExecutionResult.
 *
 * Responsibilities:
 * - Select the best tool via `selectTool()` (fast path: suggestedTool; LLM fallback)
 * - Invoke the tool through `IToolRegistry`
 * - Store the result in short-term memory under `task:{taskId}:step:{stepId}`
 * - Return a fully-populated `ExecutionResult` with logs and confidence score
 * - On any error: catch, log, and return a failure result (never throw)
 */

import type { ExecutionResult, ExecutionContext, ToolName, JSONSchema } from "../../../types";
import type { IToolRegistry } from "../../tools/ToolRegistry";
import type { IMemorySystem } from "../../memory/MemorySystem";
import type { IGeminiClient } from "./toolSelection";
import { selectTool } from "./toolSelection";

// ---------------------------------------------------------------------------
// Minimal step interface (avoids coupling to Mongoose Document)
// ---------------------------------------------------------------------------

export interface IStepForExecution {
  _id: string;
  taskId: string;
  description: string;
  suggestedTool: ToolName | null;
  expectedOutputSchema: JSONSchema;
}

// ---------------------------------------------------------------------------
// ExecutorAgent interface (mirrors design.md)
// ---------------------------------------------------------------------------

export interface IExecutorAgent {
  execute(
    step: IStepForExecution,
    context: ExecutionContext,
    attempt: number
  ): Promise<ExecutionResult>;
}

// ---------------------------------------------------------------------------
// Helper: build a timestamped log entry
// ---------------------------------------------------------------------------

function logEntry(message: string): string {
  return `[${new Date().toISOString()}] ${message}`;
}

// ---------------------------------------------------------------------------
// Helper: build tool input from step description
// ---------------------------------------------------------------------------

function buildToolInput(
  toolName: ToolName,
  step: IStepForExecution
): Record<string, unknown> {
  switch (toolName) {
    case "web_scraper": {
      // Extract URL from description if present
      const urlMatch = step.description.match(/https?:\/\/[^\s]+/);
      return { url: urlMatch ? urlMatch[0] : step.description };
    }

    case "calculator": {
      // Try to extract a math expression from the description.
      // Look for patterns like "25 + 10", "100 * 5", "(10 + 5) * 2", etc.
      const mathMatch = step.description.match(/[\d\s\+\-\*\/\(\)\.]+/);
      if (mathMatch) {
        const expr = mathMatch[0].trim();
        // Only use it if it looks like a real expression (has at least one operator)
        if (/[\+\-\*\/]/.test(expr)) {
          return { expression: expr };
        }
      }
      // Fallback: strip non-math characters and hope for the best
      const cleaned = step.description.replace(/[^0-9+\-*/().\s]/g, "").trim();
      return { expression: cleaned || step.description };
    }

    case "web_search":
    default:
      // Strip quotes and clean up the query
      return { query: step.description.replace(/^["']|["']$/g, "").trim() };
  }
}

// ---------------------------------------------------------------------------
// ExecutorAgent implementation
// ---------------------------------------------------------------------------

export class ExecutorAgent implements IExecutorAgent {
  constructor(
    private readonly registry: IToolRegistry,
    private readonly memory: IMemorySystem,
    private readonly gemini: IGeminiClient
  ) {}

  /**
   * Execute `step` using the best available tool.
   *
   * @param step    - The step to execute.
   * @param context - Execution context (previous results, short-term memory, task query).
   * @param attempt - 1-based attempt number (used in log messages).
   *
   * @returns A fully-populated `ExecutionResult`. Never throws.
   */
  async execute(
    step: IStepForExecution,
    context: ExecutionContext,
    attempt: number
  ): Promise<ExecutionResult> {
    const logs: string[] = [];
    const stepId = step._id;
    const taskId = step.taskId;

    // 1. Log start
    logs.push(
      logEntry(`Attempt ${attempt}: executing step "${step.description}"`)
    );

    let toolName: ToolName;
    let input: Record<string, unknown>;
    let output: unknown = null;

    try {
      // 2. Select tool
      toolName = await selectTool(step, context, this.registry, this.gemini);
      logs.push(logEntry(`Selected tool: ${toolName}`));

      // 3. Build tool input
      input = buildToolInput(toolName, step);
      logs.push(logEntry(`Invoking tool "${toolName}" with input: ${JSON.stringify(input)}`));

      // 4. Invoke tool
      const toolOutput = await this.registry.invoke(toolName, input);
      output = toolOutput;
      logs.push(logEntry(`Tool "${toolName}" completed successfully`));

      // 5. Store result in short-term memory
      const memoryKey = `task:${taskId}:step:${stepId}`;
      await this.memory.storeShortTerm(memoryKey, output);
      logs.push(logEntry(`Stored result in memory under key "${memoryKey}"`));

      // 6. Return success result
      return {
        stepId,
        toolUsed: toolName,
        input,
        output,
        status: "success",
        logs,
        confidence: 0.8,
        createdAt: new Date(),
      };
    } catch (err) {
      // 7. Catch any error and return a failure result
      const errorMessage =
        err instanceof Error ? err.message : String(err);
      logs.push(logEntry(`Error: ${errorMessage}`));

      // toolName may not have been set yet if selectTool threw
      const usedTool: ToolName =
        (typeof toolName! === "string" ? toolName! : null) ??
        step.suggestedTool ??
        "web_search";

      // input may not have been set yet
      const usedInput: Record<string, unknown> =
        typeof input! === "object" && input! !== null
          ? (input as Record<string, unknown>)
          : { query: step.description };

      return {
        stepId,
        toolUsed: usedTool,
        input: usedInput,
        output: null,
        status: "failure",
        logs,
        confidence: 0,
        createdAt: new Date(),
      };
    }
  }
}
