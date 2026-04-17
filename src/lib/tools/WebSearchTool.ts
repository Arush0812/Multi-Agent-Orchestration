/**
 * WebSearchTool — searches the web using DuckDuckGo's free instant answer API.
 *
 * No API key required. Uses the DuckDuckGo Instant Answer API which is free
 * and does not require registration.
 */

import { z } from "zod";
import type { ToolInput, ToolOutput } from "@/types/index";
import type { Tool } from "./ToolRegistry";

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const zodInputSchema = z.object({
  query: z.string().min(1),
});

const inputSchema = {
  type: "object",
  properties: {
    query: { type: "string" },
  },
  required: ["query"],
} as const;

const outputSchema = {
  type: "object",
  properties: {
    results: { type: "array" },
  },
} as const;

// ---------------------------------------------------------------------------
// Result shape
// ---------------------------------------------------------------------------

interface SearchResult {
  title: string;
  url: string;
  description: string;
}

// ---------------------------------------------------------------------------
// WebSearchTool implementation
// ---------------------------------------------------------------------------

export const WebSearchTool: Tool = {
  name: "web_search",
  description:
    "Search the web for information using DuckDuckGo. Returns a list of results with title, URL, and description.",
  inputSchema,
  outputSchema,
  zodInputSchema,

  async execute(input: ToolInput): Promise<ToolOutput> {
    const query = input["query"] as string;

    try {
      // DuckDuckGo Instant Answer API — free, no key required
      const url = new URL("https://api.duckduckgo.com/");
      url.searchParams.set("q", query);
      url.searchParams.set("format", "json");
      url.searchParams.set("no_html", "1");
      url.searchParams.set("skip_disambig", "1");

      const response = await fetch(url.toString(), {
        headers: { "Accept": "application/json" },
      });

      if (!response.ok) {
        return {
          result: [],
          metadata: { query },
          error: `Search returned status ${response.status}`,
        };
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const data = await response.json() as any;

      const results: SearchResult[] = [];

      // Abstract (main answer)
      if (data.AbstractText && data.AbstractURL) {
        results.push({
          title: data.Heading || query,
          url: data.AbstractURL,
          description: data.AbstractText,
        });
      }

      // Related topics
      if (Array.isArray(data.RelatedTopics)) {
        for (const topic of data.RelatedTopics.slice(0, 8)) {
          if (topic.Text && topic.FirstURL) {
            results.push({
              title: topic.Text.split(" - ")[0] || topic.Text.slice(0, 60),
              url: topic.FirstURL,
              description: topic.Text,
            });
          }
        }
      }

      // If no results from instant answer, return a helpful message
      if (results.length === 0) {
        return {
          result: [{
            title: `Search results for: ${query}`,
            url: `https://duckduckgo.com/?q=${encodeURIComponent(query)}`,
            description: `No instant answer found. Visit DuckDuckGo to see full results for "${query}".`,
          }],
          metadata: { query, source: "duckduckgo" },
        };
      }

      return {
        result: results,
        metadata: { query, totalResults: results.length, source: "duckduckgo" },
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        result: [],
        metadata: { query },
        error: `Search failed: ${message}`,
      };
    }
  },
};
