/**
 * MemorySystem — dual-layer memory for the multi-agent task automation system.
 *
 * Short-term memory: Redis via ioredis, with automatic fallback to an
 * in-memory Map when Redis is unavailable.
 *
 * Long-term memory: Pinecone vector DB with OpenAI embeddings.
 * Clients are initialised lazily on first use to avoid startup failures.
 * If Pinecone or OpenAI are unreachable, operations degrade gracefully.
 */

import Redis from "ioredis";
import type { MemoryMetadata, MemoryChunk } from "@/types/index";
import type { Pinecone, Index } from "@pinecone-database/pinecone";
import type OpenAI from "openai";

// ---------------------------------------------------------------------------
// MemorySystem interface (mirrors design.md)
// ---------------------------------------------------------------------------

export interface IMemorySystem {
  storeShortTerm(key: string, value: unknown, ttlSeconds?: number): Promise<void>;
  getShortTerm(key: string): Promise<unknown>;
  storeLongTerm(content: string, metadata: MemoryMetadata): Promise<void>;
  retrieveRelevant(query: string, topK?: number): Promise<MemoryChunk[]>;
}

// ---------------------------------------------------------------------------
// Long-term memory config
// ---------------------------------------------------------------------------

export interface LongTermMemoryConfig {
  pineconeApiKey?: string;
  pineconeIndex?: string;
  openaiApiKey?: string;
}

// ---------------------------------------------------------------------------
// MemorySystem implementation
// ---------------------------------------------------------------------------

export class MemorySystem implements IMemorySystem {
  private redis: Redis | null = null;
  /** Fallback store used when Redis is unavailable. */
  private fallbackMap: Map<string, { value: unknown; expiresAt: number | null }> = new Map();
  private usingFallback = false;

  // Long-term memory: lazily initialised
  private pineconeClient: Pinecone | null = null;
  private pineconeIndex: Index | null = null;
  private openaiClient: OpenAI | null = null;
  private longTermConfig: LongTermMemoryConfig;

  constructor(redisUrl?: string, longTermConfig?: LongTermMemoryConfig) {
    this.longTermConfig = longTermConfig ?? {};
    const url = redisUrl ?? process.env.REDIS_URL;

    if (url) {
      this.redis = new Redis(url, {
        // Fail fast rather than queuing commands indefinitely.
        lazyConnect: true,
        enableOfflineQueue: false,
        maxRetriesPerRequest: 0,
        connectTimeout: 3000,
      });

      // Switch to fallback on any connection-level error.
      this.redis.on("error", (err: Error) => {
        if (!this.usingFallback) {
          console.warn("[MemorySystem] Redis unavailable, falling back to in-memory Map:", err.message);
          this.usingFallback = true;
        }
      });

      // Attempt a non-blocking connect; errors are handled by the listener above.
      this.redis.connect().catch(() => {
        // Handled by the "error" event listener.
      });
    } else {
      // No Redis URL provided — use fallback immediately.
      this.usingFallback = true;
    }
  }

  // -------------------------------------------------------------------------
  // Short-term memory (Redis / in-memory fallback)
  // -------------------------------------------------------------------------

  /**
   * Store a JSON-serialisable value under `key`.
   *
   * If `ttlSeconds` is provided the key will expire after that duration.
   * Keys are expected to be pre-namespaced by the caller
   * (e.g. `task:{taskId}:step:{stepId}`).
   */
  async storeShortTerm(key: string, value: unknown, ttlSeconds?: number): Promise<void> {
    const serialized = JSON.stringify(value);

    if (!this.usingFallback && this.redis) {
      try {
        if (ttlSeconds !== undefined && ttlSeconds > 0) {
          await this.redis.set(key, serialized, "EX", ttlSeconds);
        } else {
          await this.redis.set(key, serialized);
        }
        return;
      } catch (err) {
        console.warn("[MemorySystem] Redis write failed, switching to fallback:", (err as Error).message);
        this.usingFallback = true;
      }
    }

    // Fallback path
    const expiresAt =
      ttlSeconds !== undefined && ttlSeconds > 0
        ? Date.now() + ttlSeconds * 1000
        : null;
    this.fallbackMap.set(key, { value, expiresAt });
  }

  /**
   * Retrieve a previously stored value by `key`.
   *
   * Returns `null` on cache miss or any error — never throws.
   */
  async getShortTerm(key: string): Promise<unknown> {
    try {
      if (!this.usingFallback && this.redis) {
        try {
          const raw = await this.redis.get(key);
          if (raw === null) return null;
          return JSON.parse(raw);
        } catch (err) {
          console.warn("[MemorySystem] Redis read failed, switching to fallback:", (err as Error).message);
          this.usingFallback = true;
        }
      }

      // Fallback path
      const entry = this.fallbackMap.get(key);
      if (!entry) return null;

      // Honour TTL for fallback entries.
      if (entry.expiresAt !== null && Date.now() > entry.expiresAt) {
        this.fallbackMap.delete(key);
        return null;
      }

      return entry.value;
    } catch {
      // getShortTerm must never throw.
      return null;
    }
  }

  // -------------------------------------------------------------------------
  // Long-term memory — Pinecone + OpenAI embeddings
  // -------------------------------------------------------------------------

  /**
   * Lazily initialise the OpenAI client on first use.
   */
  private getOpenAIClient(): OpenAI {
    if (!this.openaiClient) {
      // Dynamic import to avoid loading the module at startup.
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const OpenAIModule = require("openai");
      const OpenAIClass = OpenAIModule.default ?? OpenAIModule.OpenAI ?? OpenAIModule;
      const apiKey =
        this.longTermConfig.openaiApiKey ?? process.env.OPENAI_API_KEY;
      this.openaiClient = new OpenAIClass({ apiKey }) as OpenAI;
    }
    return this.openaiClient!;
  }

  /**
   * Lazily initialise the Pinecone index on first use.
   */
  private async getPineconeIndex(): Promise<Index> {
    if (!this.pineconeIndex) {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { Pinecone: PineconeClass } = require("@pinecone-database/pinecone");
      const apiKey =
        this.longTermConfig.pineconeApiKey ?? process.env.PINECONE_API_KEY;
      const indexName =
        this.longTermConfig.pineconeIndex ?? process.env.PINECONE_INDEX;

      if (!apiKey) throw new Error("PINECONE_API_KEY is not set");
      if (!indexName) throw new Error("PINECONE_INDEX is not set");

      this.pineconeClient = new PineconeClass({ apiKey }) as Pinecone;
      this.pineconeIndex = this.pineconeClient!.index(indexName) as Index;
    }
    return this.pineconeIndex!;
  }

  /**
   * Generate an embedding vector for `text` using OpenAI text-embedding-3-small.
   */
  private async generateEmbedding(text: string): Promise<number[]> {
    const client = this.getOpenAIClient();
    const response = await client.embeddings.create({
      model: "text-embedding-3-small",
      input: text,
    });
    return response.data[0].embedding;
  }

  /**
   * Store `content` in Pinecone with the given `metadata`.
   *
   * Generates an embedding via OpenAI and upserts the vector.
   * Silently skips (with a warning) if Pinecone or OpenAI are unreachable.
   */
  async storeLongTerm(content: string, metadata: MemoryMetadata): Promise<void> {
    try {
      const [embedding, index] = await Promise.all([
        this.generateEmbedding(content),
        this.getPineconeIndex(),
      ]);

      // Build a stable, unique ID from taskId + stepId + timestamp.
      const id = [
        metadata.taskId,
        metadata.stepId ?? "no-step",
        Date.now().toString(),
      ].join("_");

      await index.upsert([
        {
          id,
          values: embedding,
          metadata: {
            taskId: metadata.taskId,
            stepId: metadata.stepId ?? "",
            type: metadata.type,
            createdAt: metadata.createdAt.toISOString(),
            content,
          },
        },
      ]);
    } catch (err) {
      console.warn(
        "[MemorySystem] storeLongTerm failed, skipping:",
        (err as Error).message
      );
    }
  }

  /**
   * Retrieve the `topK` most semantically relevant memory chunks for `query`.
   *
   * Returns an empty array (with a warning) if Pinecone or OpenAI are
   * unreachable — graceful degradation per design spec.
   */
  async retrieveRelevant(query: string, topK = 5): Promise<MemoryChunk[]> {
    try {
      const [embedding, index] = await Promise.all([
        this.generateEmbedding(query),
        this.getPineconeIndex(),
      ]);

      const result = await index.query({
        vector: embedding,
        topK,
        includeMetadata: true,
      });

      return (result.matches ?? []).map((match) => {
        const raw = (match.metadata ?? {}) as Record<string, unknown>;
        const createdAtRaw = raw.createdAt as string | undefined;
        const metadata: MemoryMetadata = {
          taskId: (raw.taskId as string) ?? "",
          stepId: (raw.stepId as string) || undefined,
          type: (raw.type as MemoryMetadata["type"]) ?? "task_result",
          createdAt: createdAtRaw ? new Date(createdAtRaw) : new Date(0),
        };
        return {
          content: (raw.content as string) ?? "",
          metadata,
          score: match.score ?? 0,
        };
      });
    } catch (err) {
      console.warn(
        "[MemorySystem] retrieveRelevant failed, returning empty array:",
        (err as Error).message
      );
      return [];
    }
  }
}
