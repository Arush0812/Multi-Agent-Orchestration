/**
 * Integration tests for CalculatorTool with ToolRegistry
 */

import { describe, it, expect } from "vitest";
import { ToolRegistry } from "../ToolRegistry";
import { CalculatorTool } from "../CalculatorTool";

describe("CalculatorTool Integration", () => {
  it("should register and invoke through ToolRegistry", async () => {
    const registry = new ToolRegistry();
    registry.register(CalculatorTool);

    // Test that tool is registered
    const tool = registry.getTool("calculator");
    expect(tool).toBe(CalculatorTool);

    // Test that tool appears in list
    const tools = registry.listTools();
    const calculatorTool = tools.find(t => t.name === "calculator");
    expect(calculatorTool).toBeDefined();
    expect(calculatorTool?.description).toContain("mathematical expressions");

    // Test invocation through registry
    const result = await registry.invoke("calculator", { expression: "2 + 3 * 4" });
    expect(result.result).toBe(14);
    expect(result.metadata).toEqual({ expression: "2 + 3 * 4" });
    expect(result.error).toBeUndefined();
  });

  it("should validate input through ToolRegistry", async () => {
    const registry = new ToolRegistry();
    registry.register(CalculatorTool);

    // Test with invalid input (missing expression)
    await expect(registry.invoke("calculator", {})).rejects.toThrow("Invalid input");

    // Test with invalid input (empty expression)
    await expect(registry.invoke("calculator", { expression: "" })).rejects.toThrow("Invalid input");
  });
});