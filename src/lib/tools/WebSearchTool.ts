/**
 * WebSearchTool — searches the web using the Brave Search API.
 *
 * Requires the `BRAVE_SEARCH_API_KEY` environment variable to be set.
 * If the key is missing, returns an empty result with an error message.
 * Network errors and non-200 responses are caught and returned as errors.
 */

import { z } from "zod";
import type { ToolInput, ToolOutput } from "@/types/index";
import type { Tool } from "./ToolRegistry";

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

/** Zod schema used by ToolRegistry for runtime input validation. */
const zodInputSchema = z.object({
  query: z.string().min(1),
});

/** JSON Schema representation of the input (for ToolMetadata / design compliance). */
const inputSchema = {
  type: "object",
  properties: {
    query: { type: "string" },
  },
  required: ["query"],
} as const;

/** JSON Schema representation of the output. */
const outputSchema = {
  type: "object",
  properties: {
    results: { type: "array" },
  },
} as const;

// ---------------------------------------------------------------------------
// Result shape returned inside ToolOutput.result
// ---------------------------------------------------------------------------

interface SearchResult {
  title: string;
  url: string;
  description: string;
}

// ---------------------------------------------------------------------------
// Brave Search API response shape (partial)
// ---------------------------------------------------------------------------

interface BraveWebResult {
  title?: string;
  url?: string;
  description?: string;
}

interface BraveSearchResponse {
  web?: {
    results?: BraveWebResult[];
    totalEstimatedMatches?: number;
  };
}

// ---------------------------------------------------------------------------
// WebSearchTool implementation
// ---------------------------------------------------------------------------

export const WebSearchTool: Tool = {
  name: "web_search",
  description:
    "Search the web for information using the Brave Search API. Returns a list of results with title, URL, and description.",
  inputSchema,
  outputSchema,
  zodInputSchema,

  async execute(input: ToolInput): Promise<ToolOutput> {
    const query = input["query"] as string;

    // Check for API key
    const apiKey = process.env.BRAVE_SEARCH_API_KEY;
    if (!apiKey) {
      return {
        result: [],
        metadata: { query },
        error: "BRAVE_SEARCH_API_KEY not configured",
      };
    }

    const url = new URL("https://api.search.brave.com/res/v1/web/search");
    url.searchParams.set("q", query);
    url.searchParams.set("count", "10");

    let response: Response;
    try {
      response = await fetch(url.toString(), {
        headers: {
          Accept: "application/json",
          "Accept-Encoding": "gzip",
          "X-Subscription-Token": apiKey,
        },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        result: [],
        metadata: { query },
        error: `Network error: ${message}`,
      };
    }

    if (!response.ok) {
      return {
        result: [],
        metadata: { query },
        error: `Search API returned status ${response.status}: ${response.statusText}`,
      };
    }

    let data: BraveSearchResponse;
    try {
      data = (await response.json()) as BraveSearchResponse;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        result: [],
        metadata: { query },
        error: `Failed to parse search response: ${message}`,
      };
    }

    const rawResults: BraveWebResult[] = data.web?.results ?? [];
    const results: SearchResult[] = rawResults.map((item) => ({
      title: item.title ?? "",
      url: item.url ?? "",
      description: item.description ?? "",
    }));

    const totalResults = data.web?.totalEstimatedMatches ?? results.length;

    return {
      result: results,
      metadata: { query, totalResults },
    };
  },
};
