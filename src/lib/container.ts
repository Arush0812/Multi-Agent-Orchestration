/**
 * Dependency wiring — instantiates and connects all system components.
 *
 * Uses the Next.js module-level singleton pattern to prevent re-instantiation
 * on hot reload in development.
 */

import { MemorySystem } from "./memory/MemorySystem";
import { ToolRegistry } from "./tools/ToolRegistry";
import { WebSearchTool } from "./tools/WebSearchTool";
import { WebScraperTool } from "./tools/WebScraperTool";
import { CalculatorTool } from "./tools/CalculatorTool";
import { createGeminiClient } from "./llm/client";
import { PlannerAgent } from "./agents/planner/PlannerAgent";
import { ExecutorAgent } from "./agents/executor/ExecutorAgent";
import { ReviewerAgent } from "./agents/reviewer/ReviewerAgent";
import { Orchestrator } from "./orchestrator/Orchestrator";

// Prevent re-instantiation on hot reload in development
const globalForContainer = globalThis as unknown as {
  _orchestrator?: Orchestrator;
};

if (!globalForContainer._orchestrator) {
  // Memory — reads REDIS_URL from env automatically
  const memory = new MemorySystem();

  // Tool registry with all three tools registered
  const registry = new ToolRegistry();
  registry.register(WebSearchTool);
  registry.register(WebScraperTool);
  registry.register(CalculatorTool);

  // LLM client
  const geminiClient = createGeminiClient();

  // Agents
  const planner = new PlannerAgent(geminiClient, memory);
  const executor = new ExecutorAgent(registry, memory, geminiClient);
  const reviewer = new ReviewerAgent(geminiClient);

  // Orchestrator
  globalForContainer._orchestrator = new Orchestrator({
    planner,
    executor,
    reviewer,
    memory,
  });
}

export const orchestrator = globalForContainer._orchestrator;
