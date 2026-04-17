/**
 * Unit tests for ToolRegistry
 */

import { describe, it, expect, beforeEach } from "vitest";
import { z } from "zod";
import { ToolRegistry } from "../ToolRegistry";
import { CalculatorTool } from "../CalculatorTool";
import type { Tool } from "../ToolRegistry";
import type { ToolInput, ToolOutput, ToolName } from "@/types/index";

// ---------------------------------------------------------------------------
// Mock tool for testing
// ---------------------------------------------------------------------------

const mockTool: Tool = {
  name: "web_scraper" as ToolName, // Use different name to avoid conflicts
  description: "Mock tool for testing",
  inputSchema: { 
    type: "object", 
    properties: { value: { type: "string" } }, 
    required: ["value"] 
  },
  outputSchema: { 
    type: "object", 
    properties: { result: { type: "string" } } 
  },
  zodInputSchema: z.object({ value: z.string() }),
  async execute(input: ToolInput): Promise<ToolOutput> {
    if (input.value === "throw") {
      throw new Error("Mock error");
    }
    return { 
      result: `processed: ${input.value}`, 
      metadata: { input } 
    };
  }
};

// Mock tool without zodInputSchema for testing validation skip
const mockToolNoValidation: Tool = {
  name: "web_search" as ToolName,
  description: "Mock tool without validation",
  inputSchema: { 
    type: "object", 
    properties: { query: { type: "string" } }, 
    required: ["query"] 
  },
  outputSchema: { 
    type: "object", 
    properties: { result: { type: "array" } } 
  },
  // No zodInputSchema - validation should be skipped
  async execute(input: ToolInput): Promise<ToolOutput> {
    return { 
      result: [`search result for: ${input.query}`], 
      metadata: { query: input.query } 
    };
  }
};

describe("ToolRegistry", () => {
  let registry: ToolRegistry;

  beforeEach(() => {
    registry = new ToolRegistry();
  });

  describe("Registration and retrieval", () => {
    it("should register and retrieve a tool correctly", () => {
      registry.register(mockTool);
      
      const retrieved = registry.getTool("web_scraper");
      expect(retrieved).toBe(mockTool);
      expect(retrieved.name).toBe("web_scraper");
      expect(retrieved.description).toBe("Mock tool for testing");
    });

    it("should overwrite previously registered tool with same name", () => {
      const firstTool = { ...mockTool, description: "First tool" };
      const secondTool = { ...mockTool, description: "Second tool" };
      
      registry.register(firstTool);
      registry.register(secondTool);
      
      const retrieved = registry.getTool("web_scraper");
      expect(retrieved.description).toBe("Second tool");
    });

    it("should throw error for unregistered tool names", () => {
      expect(() => registry.getTool("web_scraper")).toThrow(
        'Tool "web_scraper" is not registered in the ToolRegistry.'
      );
    });

    it("should return correct metadata for registered tools", () => {
      registry.register(mockTool);
      registry.register(CalculatorTool);
      
      const metadata = registry.listTools();
      expect(metadata).toHaveLength(2);
      
      // Find the mock tool metadata
      const mockMetadata = metadata.find(m => m.description === "Mock tool for testing");
      expect(mockMetadata).toEqual({
        name: "web_scraper",
        description: "Mock tool for testing",
        inputSchema: mockTool.inputSchema,
        outputSchema: mockTool.outputSchema,
      });
      
      // Find the calculator tool metadata
      const calcMetadata = metadata.find(m => m.description.includes("mathematical expressions"));
      expect(calcMetadata).toEqual({
        name: "calculator",
        description: CalculatorTool.description,
        inputSchema: CalculatorTool.inputSchema,
        outputSchema: CalculatorTool.outputSchema,
      });
    });

    it("should return empty array when no tools are registered", () => {
      const metadata = registry.listTools();
      expect(metadata).toEqual([]);
    });
  });

  describe("Input validation", () => {
    beforeEach(() => {
      registry.register(mockTool);
    });

    it("should invoke tool with valid input and return result", async () => {
      const result = await registry.invoke("web_scraper", { value: "test" });
      
      expect(result.result).toBe("processed: test");
      expect(result.metadata).toEqual({ input: { value: "test" } });
    });

    it("should throw descriptive error for invalid input that fails zod validation", async () => {
      await expect(
        registry.invoke("web_scraper", { wrongField: "test" })
      ).rejects.toThrow(
        'Invalid input for tool "web_scraper":\n  - value: Invalid input: expected string, received undefined'
      );
    });

    it("should throw descriptive error for input with wrong type", async () => {
      await expect(
        registry.invoke("web_scraper", { value: 123 })
      ).rejects.toThrow(
        'Invalid input for tool "web_scraper":\n  - value: Invalid input: expected string, received number'
      );
    });

    it("should skip validation when tool has no zodInputSchema", async () => {
      registry.register(mockToolNoValidation);
      
      // This should work even with "invalid" input since validation is skipped
      const result = await registry.invoke("web_search", { query: "test query" });
      
      expect(result.result).toEqual(["search result for: test query"]);
      expect(result.metadata).toEqual({ query: "test query" });
    });

    it("should handle multiple validation errors", async () => {
      const complexTool: Tool = {
        name: "calculator" as ToolName,
        description: "Complex tool for testing multiple validation errors",
        inputSchema: { 
          type: "object", 
          properties: { 
            url: { type: "string" },
            timeout: { type: "number" }
          }, 
          required: ["url", "timeout"] 
        },
        outputSchema: { 
          type: "object", 
          properties: { content: { type: "string" } } 
        },
        zodInputSchema: z.object({ 
          url: z.string().url(),
          timeout: z.number().positive()
        }),
        async execute(): Promise<ToolOutput> {
          return { result: { content: "test" }, metadata: {} };
        }
      };

      registry.register(complexTool);

      await expect(
        registry.invoke("calculator", { url: "invalid-url", timeout: -5 })
      ).rejects.toThrow(
        'Invalid input for tool "calculator":'
      );
    });
  });

  describe("Error propagation", () => {
    beforeEach(() => {
      registry.register(mockTool);
    });

    it("should propagate errors thrown by tool.execute", async () => {
      await expect(
        registry.invoke("web_scraper", { value: "throw" })
      ).rejects.toThrow("Mock error");
    });

    it("should include tool name in error when tool is not registered", async () => {
      await expect(
        registry.invoke("web_search", { query: "test" })
      ).rejects.toThrow('Tool "web_search" is not registered in the ToolRegistry.');
    });

    it("should propagate original error from tool execution", async () => {
      const errorTool: Tool = {
        name: "web_scraper" as ToolName,
        description: "Tool that throws specific error",
        inputSchema: { type: "object", properties: {}, required: [] },
        outputSchema: { type: "object", properties: {} },
        async execute(): Promise<ToolOutput> {
          throw new Error("Specific execution error with details");
        }
      };

      registry.register(errorTool);

      await expect(
        registry.invoke("web_scraper", {})
      ).rejects.toThrow("Specific execution error with details");
    });
  });

  describe("Integration with real tools", () => {
    it("should work correctly with CalculatorTool", async () => {
      registry.register(CalculatorTool);
      
      const result = await registry.invoke("calculator", { expression: "2 + 3" });
      
      expect(result.result).toBe(5);
      expect(result.metadata).toEqual({ expression: "2 + 3" });
      expect(result.error).toBeUndefined();
    });

    it("should validate CalculatorTool input and reject invalid expressions", async () => {
      registry.register(CalculatorTool);
      
      await expect(
        registry.invoke("calculator", { wrongField: "2 + 3" })
      ).rejects.toThrow(
        'Invalid input for tool "calculator":\n  - expression: Invalid input: expected string, received undefined'
      );
    });

    it("should handle CalculatorTool returning error in result", async () => {
      registry.register(CalculatorTool);
      
      // CalculatorTool doesn't throw but returns error in ToolOutput
      const result = await registry.invoke("calculator", { expression: "invalid & expression" });
      
      expect(result.result).toBe(0);
      expect(result.error).toContain("invalid characters");
      expect(result.metadata).toEqual({ expression: "invalid & expression" });
    });
  });
});