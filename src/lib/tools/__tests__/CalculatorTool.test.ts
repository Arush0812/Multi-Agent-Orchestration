/**
 * Unit tests for CalculatorTool
 */

import { describe, it, expect } from "vitest";
import { CalculatorTool } from "../CalculatorTool";

describe("CalculatorTool", () => {
  it("should have correct metadata", () => {
    expect(CalculatorTool.name).toBe("calculator");
    expect(CalculatorTool.description).toContain("mathematical expressions");
    expect(CalculatorTool.inputSchema).toEqual({
      type: "object",
      properties: {
        expression: { type: "string" },
      },
      required: ["expression"],
    });
    expect(CalculatorTool.outputSchema).toEqual({
      type: "object",
      properties: {
        result: { type: "number" },
      },
    });
  });

  it("should evaluate simple addition", async () => {
    const result = await CalculatorTool.execute({ expression: "2 + 3" });
    
    expect(result.result).toBe(5);
    expect(result.metadata).toEqual({ expression: "2 + 3" });
    expect(result.error).toBeUndefined();
  });

  it("should evaluate simple subtraction", async () => {
    const result = await CalculatorTool.execute({ expression: "10 - 4" });
    
    expect(result.result).toBe(6);
    expect(result.metadata).toEqual({ expression: "10 - 4" });
    expect(result.error).toBeUndefined();
  });

  it("should evaluate multiplication", async () => {
    const result = await CalculatorTool.execute({ expression: "3 * 4" });
    
    expect(result.result).toBe(12);
    expect(result.metadata).toEqual({ expression: "3 * 4" });
    expect(result.error).toBeUndefined();
  });

  it("should evaluate division", async () => {
    const result = await CalculatorTool.execute({ expression: "15 / 3" });
    
    expect(result.result).toBe(5);
    expect(result.metadata).toEqual({ expression: "15 / 3" });
    expect(result.error).toBeUndefined();
  });

  it("should evaluate expressions with parentheses", async () => {
    const result = await CalculatorTool.execute({ expression: "10 * (5 - 2)" });
    
    expect(result.result).toBe(30);
    expect(result.metadata).toEqual({ expression: "10 * (5 - 2)" });
    expect(result.error).toBeUndefined();
  });

  it("should evaluate decimal numbers", async () => {
    const result = await CalculatorTool.execute({ expression: "15.5 / 2.5" });
    
    expect(result.result).toBe(6.2);
    expect(result.metadata).toEqual({ expression: "15.5 / 2.5" });
    expect(result.error).toBeUndefined();
  });

  it("should handle complex expressions", async () => {
    const result = await CalculatorTool.execute({ expression: "2 + 3 * 4 - 1" });
    
    expect(result.result).toBe(13); // 2 + 12 - 1 = 13
    expect(result.metadata).toEqual({ expression: "2 + 3 * 4 - 1" });
    expect(result.error).toBeUndefined();
  });

  it("should handle expressions with spaces", async () => {
    const result = await CalculatorTool.execute({ expression: "  2   +   3  " });
    
    expect(result.result).toBe(5);
    expect(result.metadata).toEqual({ expression: "2   +   3" });
    expect(result.error).toBeUndefined();
  });

  it("should return error for invalid characters", async () => {
    const result = await CalculatorTool.execute({ expression: "2 + 3 & 4" });
    
    expect(result.result).toBe(0);
    expect(result.metadata).toEqual({ expression: "2 + 3 & 4" });
    expect(result.error).toContain("invalid characters");
  });

  it("should return error for empty expression", async () => {
    const result = await CalculatorTool.execute({ expression: "" });
    
    expect(result.result).toBe(0);
    expect(result.metadata).toEqual({ expression: "" });
    expect(result.error).toContain("cannot be empty");
  });

  it("should return error for whitespace-only expression", async () => {
    const result = await CalculatorTool.execute({ expression: "   " });
    
    expect(result.result).toBe(0);
    expect(result.metadata).toEqual({ expression: "" });
    expect(result.error).toContain("cannot be empty");
  });

  it("should return error for invalid expression format", async () => {
    const result = await CalculatorTool.execute({ expression: "2 + + 3" });
    
    expect(result.result).toBe(0);
    expect(result.metadata).toEqual({ expression: "2 + + 3" });
    expect(result.error).toContain("Invalid expression format");
  });

  it("should return error for expression starting with invalid operator", async () => {
    const result = await CalculatorTool.execute({ expression: "+ 2 + 3" });
    
    expect(result.result).toBe(0);
    expect(result.metadata).toEqual({ expression: "+ 2 + 3" });
    expect(result.error).toContain("Invalid expression format");
  });

  it("should return error for expression ending with operator", async () => {
    const result = await CalculatorTool.execute({ expression: "2 + 3 +" });
    
    expect(result.result).toBe(0);
    expect(result.metadata).toEqual({ expression: "2 + 3 +" });
    expect(result.error).toContain("Invalid expression format");
  });

  it("should return error for division by zero", async () => {
    const result = await CalculatorTool.execute({ expression: "5 / 0" });
    
    expect(result.result).toBe(0);
    expect(result.metadata).toEqual({ expression: "5 / 0" });
    expect(result.error).toContain("Evaluation failed");
  });

  it("should handle negative numbers", async () => {
    const result = await CalculatorTool.execute({ expression: "(-5) + 3" });
    
    expect(result.result).toBe(-2);
    expect(result.metadata).toEqual({ expression: "(-5) + 3" });
    expect(result.error).toBeUndefined();
  });
});