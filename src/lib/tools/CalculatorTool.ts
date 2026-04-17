/**
 * CalculatorTool — safely evaluates mathematical expressions.
 *
 * Security:
 *  - Only allows basic arithmetic operations (+, -, *, /, parentheses, numbers, decimal points, spaces)
 *  - Uses Function constructor with restricted scope instead of eval
 *  - Validates expression contains only safe characters before evaluation
 *
 * Supported operations: addition, subtraction, multiplication, division, parentheses
 * Example expressions: "2 + 3", "10 * (5 - 2)", "15.5 / 2.5"
 *
 * On invalid expression or evaluation error: returns ToolOutput with result: 0, error message
 * On success: returns ToolOutput with result: number, metadata with expression
 */

import { z } from "zod";
import type { ToolInput, ToolOutput } from "@/types/index";
import type { Tool } from "./ToolRegistry";

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

/** Zod schema used by ToolRegistry for runtime input validation. */
const zodInputSchema = z.object({
  expression: z.string().min(1),
});

/** JSON Schema representation of the input (for ToolMetadata / design compliance). */
const inputSchema = {
  type: "object",
  properties: {
    expression: { type: "string" },
  },
  required: ["expression"],
} as const;

/** JSON Schema representation of the output. */
const outputSchema = {
  type: "object",
  properties: {
    result: { type: "number" },
  },
} as const;

// ---------------------------------------------------------------------------
// Safe expression evaluation helpers
// ---------------------------------------------------------------------------

/**
 * Validates that the expression contains only safe characters for mathematical evaluation.
 * Allowed: digits, +, -, *, /, (, ), spaces, and decimal points
 */
function isSafeExpression(expression: string): boolean {
  // Only allow digits, basic math operators, parentheses, spaces, and decimal points
  const safePattern = /^[0-9+\-*/().\s]+$/;
  return safePattern.test(expression);
}

/**
 * Safely evaluates a mathematical expression using Function constructor with restricted scope.
 * Returns the numeric result or throws an error if evaluation fails.
 */
function safeEvaluate(expression: string): number {
  // Additional validation: ensure no consecutive operators (except for negative numbers)
  const invalidPatterns = [
    /[+\-*/]{2,}/, // Multiple consecutive operators
    /[+*/]\s*[+*/]/, // Invalid operator combinations
    /^\s*[+*/]/, // Starting with invalid operator
    /[+\-*/]\s*$/, // Ending with operator
  ];

  for (const pattern of invalidPatterns) {
    if (pattern.test(expression)) {
      throw new Error("Invalid expression format");
    }
  }

  // Use Function constructor with restricted scope (no access to global variables)
  // This is safer than eval as it doesn't have access to the current scope
  try {
    const func = new Function('return (' + expression + ')');
    const result = func();
    
    // Ensure result is a finite number
    if (typeof result !== 'number' || !isFinite(result)) {
      throw new Error("Expression did not evaluate to a valid number");
    }
    
    return result;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Evaluation failed: ${message}`);
  }
}

// ---------------------------------------------------------------------------
// CalculatorTool implementation
// ---------------------------------------------------------------------------

export const CalculatorTool: Tool = {
  name: "calculator",
  description:
    "Safely evaluate mathematical expressions with basic arithmetic operations. " +
    "Supports addition (+), subtraction (-), multiplication (*), division (/), and parentheses. " +
    "Example: '2 + 3 * (4 - 1)' returns 11.",
  inputSchema,
  outputSchema,
  zodInputSchema,

  async execute(input: ToolInput): Promise<ToolOutput> {
    const expression = (input["expression"] as string).trim();

    // Check for empty expression after trimming
    if (expression.length === 0) {
      return {
        result: 0,
        metadata: { expression },
        error: "Expression cannot be empty",
      };
    }

    // Validate expression contains only safe characters
    if (!isSafeExpression(expression)) {
      return {
        result: 0,
        metadata: { expression },
        error: "Expression contains invalid characters. Only numbers, +, -, *, /, (, ), and spaces are allowed.",
      };
    }

    try {
      const result = safeEvaluate(expression);
      
      return {
        result,
        metadata: { expression },
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        result: 0,
        metadata: { expression },
        error: message,
      };
    }
  },
};