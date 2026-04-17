/**
 * WebScraperTool — scrapes a web page using Playwright headless Chromium.
 *
 * Security:
 *  - Only `http:` and `https:` protocols are allowed (allowlist).
 *  - Private/internal IP ranges, localhost, and IPv6 loopback are blocked (SSRF denylist).
 *    Blocked: localhost, 127.x.x.x, 0.0.0.0, ::1, 10.x.x.x, 172.16-31.x.x, 192.168.x.x, file://, ftp://
 *
 * Behaviour:
 *  - Navigation timeout: 30 seconds, wait for load: 10 seconds.
 *  - Returns the page's body text content and title metadata on success.
 *  - Returns `result: { content: "" }` with a descriptive `error` on any failure.
 *  - Always closes the browser in a `finally` block.
 */

import { z } from "zod";
import type { ToolInput, ToolOutput } from "@/types/index";
import type { Tool } from "./ToolRegistry";

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

/** Zod schema used by ToolRegistry for runtime input validation. */
const zodInputSchema = z.object({
  url: z.string().url(),
});

/** JSON Schema representation of the input (for ToolMetadata / design compliance). */
const inputSchema = {
  type: "object",
  properties: {
    url: { type: "string" },
  },
  required: ["url"],
} as const;

/** JSON Schema representation of the output. */
const outputSchema = {
  type: "object",
  properties: {
    content: { type: "string" },
  },
} as const;

// ---------------------------------------------------------------------------
// URL validation helpers
// ---------------------------------------------------------------------------

/**
 * Returns `true` if the URL is on the denylist (SSRF protection), `false` otherwise.
 *
 * Denylist covers:
 *  - localhost / localhost.
 *  - IPv4 loopback: 127.x.x.x
 *  - Unspecified: 0.0.0.0
 *  - IPv6 loopback: ::1
 *  - Private range A: 10.x.x.x
 *  - Private range B: 172.16.x.x – 172.31.x.x
 *  - Private range C: 192.168.x.x
 *  - file:// and ftp:// schemes
 */
function isDeniedUrl(rawUrl: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    // Unparseable URLs are treated as denied
    return true;
  }

  // Protocol allowlist — only http and https
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return true;
  }

  const hostname = parsed.hostname.toLowerCase();

  // Localhost
  if (hostname === "localhost" || hostname === "localhost.") {
    return true;
  }

  // IPv6 loopback
  if (hostname === "::1" || hostname === "[::1]") {
    return true;
  }

  // Unspecified address
  if (hostname === "0.0.0.0") {
    return true;
  }

  // IPv4 loopback: 127.x.x.x
  if (/^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname)) {
    return true;
  }

  // Private range A: 10.x.x.x
  if (/^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname)) {
    return true;
  }

  // Private range B: 172.16.x.x – 172.31.x.x
  const range172 = /^172\.(\d{1,3})\.\d{1,3}\.\d{1,3}$/.exec(hostname);
  if (range172) {
    const second = parseInt(range172[1], 10);
    if (second >= 16 && second <= 31) {
      return true;
    }
  }

  // Private range C: 192.168.x.x
  if (/^192\.168\.\d{1,3}\.\d{1,3}$/.test(hostname)) {
    return true;
  }

  return false;
}

// ---------------------------------------------------------------------------
// WebScraperTool implementation
// ---------------------------------------------------------------------------

export const WebScraperTool: Tool = {
  name: "web_scraper",
  description:
    "Scrape the text content of a public web page using a headless browser. " +
    "Only http/https URLs are allowed; private/internal IP ranges and localhost are blocked.",
  inputSchema,
  outputSchema,
  zodInputSchema,

  async execute(input: ToolInput): Promise<ToolOutput> {
    const url = input["url"] as string;

    // --- URL security checks (SSRF denylist) ---
    if (isDeniedUrl(url)) {
      return {
        result: { content: "" },
        metadata: { url },
        error: "URL is not allowed",
      };
    }

    // --- Playwright scraping ---
    // Dynamic import so the module is only loaded when actually needed.
    const { chromium } = await import("playwright");

    const browser = await chromium.launch({ headless: true });
    try {
      const context = await browser.newContext();
      const page = await context.newPage();

      await page.goto(url, { timeout: 30_000, waitUntil: "domcontentloaded" });
      
      // Wait for page to load completely
      await page.waitForTimeout(10_000);

      const [content, title] = await Promise.all([
        page.textContent("body"),
        page.title(),
      ]);

      return {
        result: { content: content || "" },
        metadata: { url, title },
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        result: { content: "" },
        metadata: { url },
        error: message,
      };
    } finally {
      await browser.close();
    }
  },
};
