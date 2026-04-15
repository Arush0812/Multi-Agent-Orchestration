/**
 * ToolRegistry — central registry for all available tools.
 *
 * Tools can be registered at runtime via `register(tool)`.
 * Input validation uses an optional `zodInputSchema` property on the Tool;
 * if present, the input is validated before `execute` is called.
 */

import { z } from "zod";
import type { ToolName, ToolInput, ToolOutput, ToolMetadata, JSONSchema } from "@/types/index";

// ---------------------------------------------------------------------------
// Tool interface
// ---------------------------------------------------------------------------

/**
 * A single executable tool.
 *
 * The optional `zodInputSchema` is used for runtime input validation inside
 * `ToolRegistry.invoke`. If omitted, validation is skipped and `execute` is
 * called directly.
 */
export interface Tool {
  name: ToolName;
  description: string;
  inputSchema: JSONSchema;
  outputSchema: JSONSchema;
  zodInputSchema?: z.ZodTypeAny;
  execute(input: ToolInput): Promise<ToolOutput>;
}

// ---------------------------------------------------------------------------
// ToolRegistry interface (mirrors design.md)
// ---------------------------------------------------------------------------

export interface IToolRegistry {
  getTool(name: ToolName): Tool;
  listTools(): ToolMetadata[];
  invoke(name: ToolName, input: ToolInput): Promise<ToolOutput>;
}

// ---------------------------------------------------------------------------
// ToolRegistry implementation
// ---------------------------------------------------------------------------

export class ToolRegistry implements IToolRegistry {
  private tools: Map<ToolName, Tool> = new Map();

  /**
   * Register a tool. Overwrites any previously registered tool with the same name.
   */
  register(tool: Tool): void {
    this.tools.set(tool.name, tool);
  }

  /**
   * Return the `Tool` instance for `name`.
   *
   * @throws {Error} if no tool with that name is registered.
   */
  getTool(name: ToolName): Tool {
    const tool = this.tools.get(name);
    if (!tool) {
      throw new Error(`Tool "${name}" is not registered in the ToolRegistry.`);
    }
    return tool;
  }

  /**
   * Return static metadata for every registered tool.
   */
  listTools(): ToolMetadata[] {
    return Array.from(this.tools.values()).map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
      outputSchema: tool.outputSchema,
    }));
  }

  /**
   * Validate `input` against the tool's `zodInputSchema` (if present), then
   * call `tool.execute(input)`.
   *
   * @throws {Error} if the tool is not registered.
   * @throws {Error} with a descriptive message if input validation fails.
   */
  async invoke(name: ToolName, input: ToolInput): Promise<ToolOutput> {
    const tool = this.getTool(name);

    if (tool.zodInputSchema) {
      const result = tool.zodInputSchema.safeParse(input);
      if (!result.success) {
        const issues = result.error.issues
          .map((issue) => `  - ${issue.path.join(".") || "(root)"}: ${issue.message}`)
          .join("\n");
        throw new Error(
          `Invalid input for tool "${name}":\n${issues}`
        );
      }
    }

    return tool.execute(input);
  }
}
