# Implementation Plan: Multi-Agent AI Task Automation System

## Overview

Implement a TypeScript/Next.js multi-agent system with a Planner, Executor, and Reviewer agent coordinated by an Orchestrator. The system uses MongoDB for persistence, Redis for short-term memory, and a vector DB for long-term semantic memory. Each component is built incrementally and wired together at the end.

## Tasks

- [x] 1. Project setup and core type definitions
  - Initialize Next.js project with TypeScript strict mode
  - Install all dependencies: `openai`, `mongoose`, `ioredis`, `@pinecone-database/pinecone`, `playwright`, `zod`, `fast-check`, `tailwindcss`
  - Define all shared TypeScript interfaces: `PlannedStep`, `ExecutionResult`, `ReviewDecision`, `ExecutionContext`, `PlannerContext`, `FinalResult`, `MemoryChunk`, `MemoryMetadata`, `ToolInput`, `ToolOutput`, `ToolMetadata`
  - Define `ToolName` union type and `JSONSchema` type alias
  - Create `src/types/index.ts` exporting all interfaces
  - _Requirements: all_

- [ ] 2. MongoDB data models
  - [x] 2.1 Implement `Task` Mongoose model
    - Define schema with fields: `userQuery`, `status` enum, `steps`, `finalResult`, `errorMessage`, `createdAt`, `updatedAt`
    - Add validation: `userQuery` non-empty max 2000 chars, `status` enum constraint
    - Add index on `_id`
    - _Requirements: data model_

  - [x] 2.2 Implement `Step` Mongoose model
    - Define schema with fields: `taskId`, `description`, `order`, `status` enum, `suggestedTool`, `expectedOutputSchema`, `executions`, `finalExecutionId`, timestamps
    - Add validation: `order` non-negative integer, `description` non-empty
    - Add compound index on `taskId + order`
    - _Requirements: data model_

  - [x] 2.3 Implement `Execution` Mongoose model
    - Define schema with fields: `stepId`, `attempt`, `toolUsed`, `input`, `output`, `status`, `reviewDecision`, `logs`, `confidence`, `createdAt`
    - Add validation: `attempt >= 1`, `confidence` float in [0, 1], `logs` append-only array
    - Add index on `stepId`
    - _Requirements: data model_

  - [-] 2.4 Write unit tests for data model validation
    - Test `userQuery` max length enforcement
    - Test `status` enum constraints on Task, Step, Execution
    - Test `confidence` bounds validation
    - Test `order` uniqueness within a task

- [ ] 3. Memory system
  - [~] 3.1 Implement `MemorySystem` with Redis short-term memory
    - Create `src/lib/memory/MemorySystem.ts` implementing the `MemorySystem` interface
    - Implement `storeShortTerm(key, value, ttlSeconds?)` using `ioredis` with JSON serialization
    - Implement `getShortTerm(key)` returning `null` on cache miss, never throwing
    - Namespace all keys by `taskId` to prevent cross-task contamination
    - Implement Redis unavailability fallback using an in-memory `Map`
    - _Requirements: memory system_

  - [~] 3.2 Implement long-term vector memory with Pinecone
    - Implement `storeLongTerm(content, metadata)` using OpenAI embeddings + Pinecone upsert
    - Implement `retrieveRelevant(query, topK?)` using cosine similarity search; return `MemoryChunk[]` with scores
    - Implement graceful degradation: if Pinecone is unreachable, log warning and return empty array
    - _Requirements: memory system_

  - [~] 3.3 Write property test for memory namespacing
    - **Property: Memory namespacing isolation** — storing under `taskId:A` never affects retrieval under `taskId:B` for any two distinct task IDs
    - **Validates: memory system correctness property**

  - [~] 3.4 Write unit tests for short-term memory
    - Test store/retrieve round-trip
    - Test TTL expiry behavior
    - Test Redis fallback to in-memory Map
    - Test `null` return on cache miss

- [ ] 4. Tool registry and built-in tools
  - [~] 4.1 Implement `ToolRegistry`
    - Create `src/lib/tools/ToolRegistry.ts` implementing the `ToolRegistry` interface
    - Implement `getTool(name)`, `listTools()`, `invoke(name, input)` methods
    - Validate tool input against `inputSchema` (using `zod`) before execution; throw on invalid input
    - _Requirements: tool registry_

  - [~] 4.2 Implement `WebSearchTool`
    - Create `src/lib/tools/WebSearchTool.ts` implementing the `Tool` interface
    - Define `inputSchema` (query string) and `outputSchema` (results array) using zod
    - Implement `execute(input)` calling a search API; return `ToolOutput` with result and metadata
    - Handle network errors: catch exceptions, set `error` field on `ToolOutput`
    - _Requirements: tool execution_

  - [~] 4.3 Implement `WebScraperTool`
    - Create `src/lib/tools/WebScraperTool.ts` using Playwright headless browser
    - Enforce URL allowlist/denylist before scraping
    - Run in sandboxed context; return page text content as `ToolOutput`
    - Handle timeouts and navigation errors gracefully
    - _Requirements: tool execution, security_

  - [~] 4.4 Implement `CalculatorTool`
    - Create `src/lib/tools/CalculatorTool.ts`
    - Define `inputSchema` (expression string) and `outputSchema` (numeric result)
    - Implement safe expression evaluation (no `eval`); return `ToolOutput`
    - _Requirements: tool execution_

  - [~] 4.5 Write property test for tool input/output schema compliance
    - **Property: Tool schema compliance** — for any valid `ToolInput` matching a tool's `inputSchema`, the returned `ToolOutput` matches the declared `outputSchema`
    - **Validates: tool registry correctness property**

  - [~] 4.6 Write unit tests for ToolRegistry
    - Test `getTool` returns correct tool by name
    - Test `invoke` validates input schema before calling `execute`
    - Test error propagation when tool throws

- [ ] 5. Planner Agent
  - [~] 5.1 Implement prompt builders for Planner
    - Create `src/lib/agents/planner/prompts.ts`
    - Implement `buildPlannerSystemPrompt()` returning a non-empty system prompt string
    - Implement `buildPlannerUserPrompt(query, memoryChunks)` — include query and memory context; instruct LLM to return JSON with a `steps` array
    - _Requirements: planner agent_

  - [~] 5.2 Implement `validateAndNormalizePlan()`
    - Create `src/lib/agents/planner/validation.ts`
    - Parse raw LLM JSON response into `PlannedStep[]`
    - Sort steps by `order` ascending
    - Assert steps have unique, sequential order values starting at 1
    - Throw `PlanValidationError` if required fields are missing or malformed
    - _Requirements: planner agent_

  - [~] 5.3 Write property test for `validateAndNormalizePlan`
    - **Property: Sequential step ordering** — `validateAndNormalizePlan(raw)` always returns steps with unique, sequential order values for any valid input shape
    - **Validates: planner correctness property**

  - [~] 5.4 Implement `PlannerAgent`
    - Create `src/lib/agents/planner/PlannerAgent.ts` implementing the `PlannerAgent` interface
    - Call `memory.retrieveRelevant(query, 5)` to build `PlannerContext`
    - Call OpenAI `gpt-4o` with `response_format: json_object`
    - Parse response with `validateAndNormalizePlan`
    - _Requirements: planner agent_

  - [~] 5.5 Write unit tests for PlannerAgent
    - Mock OpenAI response; assert returned `PlannedStep[]` structure and ordering
    - Test `PlanValidationError` thrown on malformed LLM response
    - Test memory context is included in prompt

- [ ] 6. Executor Agent and tool selection
  - [~] 6.1 Implement `selectTool()` function
    - Create `src/lib/agents/executor/toolSelection.ts`
    - Fast path: return `step.suggestedTool` if it is registered in `ToolRegistry`
    - LLM fallback: call `gpt-4o-mini` with tool list and step description; parse `toolName` from JSON response
    - Assert selected tool is registered; throw if not
    - _Requirements: executor agent_

  - [~] 6.2 Implement `ExecutorAgent`
    - Create `src/lib/agents/executor/ExecutorAgent.ts` implementing the `ExecutorAgent` interface
    - Call `selectTool` to determine tool, invoke via `ToolRegistry`
    - Store result in short-term memory under `task:{taskId}:step:{stepId}`
    - Return `ExecutionResult` with `toolUsed`, `input`, `output`, `status`, `logs`, `confidence`, `createdAt`
    - Catch tool exceptions: set `status: "failure"`, log error in `logs[]`
    - _Requirements: executor agent_

  - [~] 6.3 Write unit tests for ExecutorAgent
    - Mock `ToolRegistry`; assert `ExecutionResult` shape and log population
    - Test failure path: tool throws → `status: "failure"` in result
    - Test short-term memory is called with correct key

- [ ] 7. Reviewer Agent
  - [~] 7.1 Implement `ReviewerAgent`
    - Create `src/lib/agents/reviewer/ReviewerAgent.ts` implementing the `ReviewerAgent` interface
    - Validate `result.output` structure against `step.expectedOutputSchema` using zod
    - Call OpenAI to assess relevance to `taskQuery`; parse `ReviewDecision` from JSON response
    - Ensure `decision` is exactly `"accept"` or `"reject"`, never undefined
    - Return `ReviewDecision` with `reason`, optional `suggestions`, and `confidence`
    - _Requirements: reviewer agent_

  - [~] 7.2 Write unit tests for ReviewerAgent
    - Mock step + result pairs; assert `ReviewDecision` correctness
    - Test schema validation failure produces `"reject"` decision
    - Test `decision` is always `"accept"` or `"reject"`

- [ ] 8. Orchestrator and retry logic
  - [~] 8.1 Implement `executeWithRetry()`
    - Create `src/lib/orchestrator/retry.ts`
    - Loop up to `maxAttempts` (default 3); call `executor.execute` then `reviewer.review` each iteration
    - On `"accept"`: return result immediately
    - On `"reject"`: log rejection, increment attempt, pass `rejectionReason` in next `ExecutionContext`
    - After all attempts exhausted: return last result with `status: "failure"`
    - Persist each attempt as an `Execution` document
    - _Requirements: retry logic_

  - [~] 8.2 Write property test for `executeWithRetry` termination
    - **Property: Retry loop termination** — `executeWithRetry` always terminates within `maxAttempts` iterations regardless of reviewer decisions
    - **Validates: retry loop correctness property**

  - [~] 8.3 Implement `Orchestrator`
    - Create `src/lib/orchestrator/Orchestrator.ts` implementing the `Orchestrator` interface
    - Implement `startTask(taskId, query)`: update status → plan → persist steps → execute loop → assemble result
    - Implement `getTaskStatus(taskId)`: query MongoDB for current task state
    - Implement `abortTask(taskId)`: mark task and pending steps as `"failed"`
    - Enforce loop invariant: all steps before index `i` are terminal before step `i` begins
    - Emit progress events (SSE-compatible) after each step completes
    - _Requirements: orchestrator_

  - [~] 8.4 Implement `assembleFinalResult()`
    - Create `src/lib/orchestrator/assembly.ts`
    - Accept `taskQuery` and `stepResults[]` (all `status: "success"`, ordered by step `order`)
    - Return `FinalResult` with non-empty `summary`, structured `data`, and full `stepResults`
    - Function must be deterministic: same inputs → structurally equivalent output
    - _Requirements: orchestrator_

  - [~] 8.5 Write property test for `assembleFinalResult` determinism
    - **Property: Assembly determinism** — `assembleFinalResult` is deterministic: same inputs always produce structurally equivalent outputs
    - **Validates: assembly correctness property**

  - [~] 8.6 Write unit tests for Orchestrator
    - Test full happy-path: plan → execute → review accept → completed status
    - Test failure propagation: step fails after max retries → task status `"failed"`
    - Test `abortTask` marks all pending steps as failed

- [~] 9. Checkpoint — Ensure all unit and property tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 10. Next.js API routes
  - [~] 10.1 Implement `POST /api/tasks` route
    - Create `src/app/api/tasks/route.ts`
    - Validate request body with zod: `userQuery` non-empty, max 2000 chars
    - Sanitize `userQuery` to prevent prompt injection
    - Create `Task` document with `status: "pending"`
    - Trigger `orchestrator.startTask` asynchronously (do not await in response)
    - Return `{ taskId }` immediately
    - Apply JWT/session authentication guard
    - Apply Redis-based rate limiting (10 tasks/minute per user)
    - _Requirements: API, security_

  - [~] 10.2 Implement `GET /api/tasks/[id]` status route
    - Create `src/app/api/tasks/[id]/route.ts`
    - Call `orchestrator.getTaskStatus(taskId)`
    - Return task with `status`, `steps[]`, and progress fraction
    - _Requirements: API_

  - [~] 10.3 Implement `GET /api/tasks/[id]/result` SSE route
    - Create `src/app/api/tasks/[id]/result/route.ts`
    - Stream step completions to client using Server-Sent Events
    - Return full `FinalResult` when task reaches `"completed"` status
    - _Requirements: API, streaming_

  - [~] 10.4 Write integration tests for API routes
    - Full lifecycle test: POST task → poll status → GET result using real MongoDB test instance and mocked OpenAI/tools
    - Retry flow test: configure Reviewer mock to reject N times; assert exactly N+1 `Execution` documents created
    - Test rate limiting rejects requests over threshold

- [ ] 11. Frontend UI
  - [~] 11.1 Implement task submission form
    - Create `src/app/page.tsx` with a textarea for `userQuery` and a submit button
    - POST to `/api/tasks` on submit; store returned `taskId` in component state
    - Show loading state while task is pending
    - _Requirements: UI_

  - [~] 11.2 Implement task progress and result display
    - Create `src/components/TaskProgress.tsx`
    - Connect to SSE endpoint `GET /api/tasks/[id]/result` to receive live step updates
    - Display each step's status, tool used, and output as it completes
    - Render `FinalResult.summary` and structured data when task completes
    - Sanitize all rendered output to prevent XSS
    - _Requirements: UI, security_

- [~] 12. OpenAI error handling and exponential backoff
  - Create `src/lib/openai/client.ts` wrapping the OpenAI SDK
  - Implement exponential backoff with jitter for 429 and 5xx responses (max 3 retries, base delay 1s)
  - If all retries fail, throw a structured error that the caller (Planner/Executor/Reviewer) can catch and mark the step as `"failed"`
  - _Requirements: error handling_

- [ ] 13. Wire all components together
  - [~] 13.1 Instantiate and connect all dependencies
    - Create `src/lib/container.ts` (or use Next.js module singletons)
    - Instantiate `MemorySystem`, `ToolRegistry` (register all three tools), `PlannerAgent`, `ExecutorAgent`, `ReviewerAgent`, `Orchestrator` with all dependencies injected
    - Export a single `orchestrator` singleton for use in API routes
    - _Requirements: all_

  - [~] 13.2 Configure environment and Docker
    - Create `.env.example` with all required variables: `OPENAI_API_KEY`, `MONGODB_URI`, `REDIS_URL`, `PINECONE_API_KEY`, `PINECONE_INDEX`
    - Create `Dockerfile` and `docker-compose.yml` for local dev (Next.js app + MongoDB + Redis)
    - Add MongoDB indexes: `Task._id`, `Step.taskId+order`, `Execution.stepId`
    - _Requirements: infrastructure_

- [~] 14. Final checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for a faster MVP
- Each task references the design component it implements for traceability
- Property tests use `fast-check` as specified in the design
- Checkpoints ensure incremental validation before moving to the next phase
- The OpenAI model tiering from the design is respected: `gpt-4o` for planning/assembly, `gpt-4o-mini` for tool selection and review
