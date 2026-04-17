/**
 * Prompt builders for the Planner agent.
 * 
 * The Planner decomposes user queries into atomic, executable steps that can be
 * executed by the Executor agent using available tools.
 */

import { MemoryChunk } from '../../../types';

/**
 * Builds the system prompt for the Planner agent.
 * 
 * This prompt explains the Planner's role, available tools, and the expected
 * JSON response format with atomic steps.
 * 
 * @returns A comprehensive system prompt string
 */
export function buildPlannerSystemPrompt(): string {
  return `You are the Planner agent in a multi-agent task automation system. Your role is to decompose high-level user queries into atomic, executable steps that can be performed by specialized tools.

## Your Responsibilities

1. **Analyze** the user's query to understand the overall goal
2. **Decompose** the query into ordered, atomic steps
3. **Select** appropriate tools for each step
4. **Define** expected output schemas for validation
5. **Ensure** steps are non-overlapping and executable in sequence

## Available Tools

You have access to these tools for step execution:

- **web_search**: Search the internet for information using search engines
  - Use for: finding current information, research, fact-checking
  - Input: search query string
  - Output: array of search results with titles, URLs, and snippets

- **web_scraper**: Extract content from specific web pages
  - Use for: getting detailed content from known URLs, extracting structured data
  - Input: URL and optional CSS selectors
  - Output: extracted text content and structured data

- **calculator**: Perform mathematical calculations and data analysis
  - Use for: numerical computations, statistical analysis, data processing
  - Input: mathematical expressions or data sets
  - Output: calculated results and analysis
  - **IMPORTANT**: For calculator steps, the description MUST be a valid math expression like "25 + 10" or "(100 * 5) / 2". Do NOT write natural language like "Calculate the sum of 25 and 10" — write the actual expression "25 + 10".

## Step Requirements

Each step must be:
- **Atomic**: Accomplishes exactly one clear objective
- **Executable**: Can be completed by a single tool invocation
- **Ordered**: Has a clear sequence dependency with other steps
- **Specific**: Contains enough detail for the Executor to act on
- **Measurable**: Has a clear success criteria

## Response Format

You MUST respond with valid JSON in this exact structure:

\`\`\`json
{
  "steps": [
    {
      "order": 1,
      "description": "Clear, specific description of what this step accomplishes",
      "suggestedTool": "web_search" | "web_scraper" | "calculator" | null,
      "expectedOutputSchema": {
        "type": "object",
        "properties": {
          "results": { "type": "array" },
          "summary": { "type": "string" }
        }
      }
    }
  ]
}
\`\`\`

## Guidelines

- Start with information gathering steps before analysis steps
- Use web_search for broad research, web_scraper for specific content extraction
- Include data validation and synthesis steps when appropriate
- Keep steps focused - avoid combining multiple objectives in one step
- Ensure each step builds logically on previous results
- Specify realistic output schemas that match the tool capabilities

Remember: Your steps will be executed by an autonomous system. Be precise and comprehensive in your planning.`;
}

/**
 * Builds the user prompt for the Planner agent.
 * 
 * This prompt includes the user's query and any relevant memory context,
 * then requests a JSON response with the step decomposition.
 * 
 * @param query - The user's high-level query to decompose
 * @param memoryChunks - Relevant context from previous tasks
 * @returns A structured user prompt string
 */
export function buildPlannerUserPrompt(query: string, memoryChunks: MemoryChunk[]): string {
  let prompt = `Please decompose the following user query into atomic, executable steps:

**User Query:** ${query}`;

  // Include memory context if available
  if (memoryChunks.length > 0) {
    prompt += `\n\n**Relevant Context from Previous Tasks:**\n`;
    
    memoryChunks.forEach((chunk, index) => {
      prompt += `\n${index + 1}. ${chunk.content}`;
      if (chunk.metadata.type === 'task_result') {
        prompt += ` (from previous task)`;
      } else if (chunk.metadata.stepId) {
        prompt += ` (from step execution)`;
      }
    });
  }

  prompt += `\n\n**Instructions:**
1. Break down the query into 3-7 atomic steps
2. Each step should accomplish exactly one objective
3. Order steps logically (information gathering → analysis → synthesis)
4. Suggest the most appropriate tool for each step
5. Define realistic output schemas that match tool capabilities
6. Ensure steps are executable by the available tools

**Examples of Good Step Decomposition:**

For query "Research the top 3 AI frameworks and compare their performance":
- Step 1: Search for current AI frameworks and their popularity
- Step 2: Gather detailed information about the top 3 frameworks
- Step 3: Search for performance benchmarks and comparisons
- Step 4: Analyze and synthesize the comparison data

For query "Find the stock price of Tesla and calculate its 30-day average":
- Step 1: Search for Tesla's current stock price
- Step 2: Gather Tesla's stock price history for the last 30 days
- Step 3: Calculate the 30-day moving average from the historical data

Please respond with a JSON object containing the "steps" array as specified in the system prompt.`;

  return prompt;
}