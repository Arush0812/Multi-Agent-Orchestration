/**
 * Shared TypeScript interfaces and types for the multi-agent task automation system.
 */

// ---------------------------------------------------------------------------
// Primitive / utility types
// ---------------------------------------------------------------------------

/** A JSON Schema object. */
export type JSONSchema = Record<string, unknown>;

/** Names of all registered tools in the system. */
export type ToolName = "web_search" | "web_scraper" | "calculator";

// ---------------------------------------------------------------------------
// Tool types
// ---------------------------------------------------------------------------

/** Arbitrary key-value input passed to a tool. */
export interface ToolInput {
  [key: string]: unknown;
}

/** Structured output returned by a tool. */
export interface ToolOutput {
  result: unknown;
  metadata: Record<string, unknown>;
  error?: string;
}

/** Static metadata describing a tool's capabilities and schemas. */
export interface ToolMetadata {
  name: ToolName;
  description: string;
  inputSchema: JSONSchema;
  outputSchema: JSONSchema;
}

// ---------------------------------------------------------------------------
// Memory types
// ---------------------------------------------------------------------------

/** Metadata attached to every item stored in long-term vector memory. */
export interface MemoryMetadata {
  taskId: string;
  stepId?: string;
  type: "task_result" | "step_output" | "user_context";
  createdAt: Date;
}

/** A single chunk retrieved from vector memory, including its similarity score. */
export interface MemoryChunk {
  content: string;
  metadata: MemoryMetadata;
  /** Cosine similarity score in [0, 1]. */
  score: number;
}

// ---------------------------------------------------------------------------
// Planning types
// ---------------------------------------------------------------------------

/** A single atomic step produced by the Planner agent. */
export interface PlannedStep {
  order: number;
  description: string;
  suggestedTool: ToolName | null;
  expectedOutputSchema: JSONSchema;
}

// ---------------------------------------------------------------------------
// Review types
// ---------------------------------------------------------------------------

/** The Reviewer agent's verdict on a single execution attempt. */
export interface ReviewDecision {
  decision: "accept" | "reject";
  reason: string;
  suggestions?: string[];
  /** Reviewer confidence in [0, 1]. */
  confidence: number;
}

// ---------------------------------------------------------------------------
// Execution types
// ---------------------------------------------------------------------------

/** The result of a single tool execution attempt for a step. */
export interface ExecutionResult {
  stepId: string;
  toolUsed: ToolName;
  input: Record<string, unknown>;
  output: unknown;
  status: "success" | "failure";
  logs: string[];
  /** Executor confidence in [0, 1]. */
  confidence: number;
  createdAt: Date;
  reviewDecision?: ReviewDecision;
}

/** Context provided to the Executor agent for a single execution attempt. */
export interface ExecutionContext {
  previousResults: ExecutionResult[];
  shortTermMemory: Record<string, unknown>;
  taskQuery: string;
  /** Rejection reason from the previous attempt, if any. */
  rejectionReason?: string;
}

// ---------------------------------------------------------------------------
// Planner context
// ---------------------------------------------------------------------------

/** Context provided to the Planner agent when decomposing a query. */
export interface PlannerContext {
  relevantMemory: MemoryChunk[];
  previousTaskSummaries?: string[];
}

// ---------------------------------------------------------------------------
// Final result
// ---------------------------------------------------------------------------

/** The assembled final result returned to the user after all steps complete. */
export interface FinalResult {
  summary: string;
  data: unknown;
  stepResults: ExecutionResult[];
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/**
 * Thrown when the Planner agent's LLM response cannot be parsed or fails
 * schema validation.  The raw LLM response is attached for debugging.
 */
export class PlanValidationError extends Error {
  rawResponse: unknown;

  constructor(message: string, rawResponse: unknown) {
    super(message);
    this.name = "PlanValidationError";
    this.rawResponse = rawResponse;

    // Restore prototype chain (required when extending built-ins in TypeScript).
    Object.setPrototypeOf(this, new.target.prototype);
  }
}
