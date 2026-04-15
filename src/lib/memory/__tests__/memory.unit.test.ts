/**
 * Unit tests for MemorySystem short-term memory.
 *
 * Covers:
 *  1. Round-trip: store then retrieve returns the same value
 *  2. TTL expiry: value is null after TTL elapses (fake timers)
 *  3. Redis fallback: invalid Redis URL falls back to in-memory Map
 *  4. Cache miss: getShortTerm on an unknown key returns null
 *  5. Multiple keys don't interfere with each other
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { MemorySystem } from "../MemorySystem";

// ---------------------------------------------------------------------------
// 1. Round-trip
// ---------------------------------------------------------------------------

describe("MemorySystem — round-trip", () => {
  it("stores a value and retrieves the same value", async () => {
    const memory = new MemorySystem(); // no Redis URL → in-memory fallback

    await memory.storeShortTerm("key:roundtrip", { hello: "world", count: 42 });
    const result = await memory.getShortTerm("key:roundtrip");

    expect(result).toEqual({ hello: "world", count: 42 });
  });

  it("handles primitive values (string, number, boolean, null)", async () => {
    const memory = new MemorySystem();

    await memory.storeShortTerm("key:string", "hello");
    await memory.storeShortTerm("key:number", 123);
    await memory.storeShortTerm("key:bool", true);
    await memory.storeShortTerm("key:null", null);

    expect(await memory.getShortTerm("key:string")).toBe("hello");
    expect(await memory.getShortTerm("key:number")).toBe(123);
    expect(await memory.getShortTerm("key:bool")).toBe(true);
    expect(await memory.getShortTerm("key:null")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 2. TTL expiry
// ---------------------------------------------------------------------------

describe("MemorySystem — TTL expiry", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns the value before TTL elapses", async () => {
    const memory = new MemorySystem();

    await memory.storeShortTerm("key:ttl", "alive", 5); // 5-second TTL

    // Advance 4 seconds — still within TTL
    vi.advanceTimersByTime(4_000);

    const result = await memory.getShortTerm("key:ttl");
    expect(result).toBe("alive");
  });

  it("returns null after TTL elapses", async () => {
    const memory = new MemorySystem();

    await memory.storeShortTerm("key:ttl-expired", "temporary", 1); // 1-second TTL

    // Advance past the TTL
    vi.advanceTimersByTime(1_001);

    const result = await memory.getShortTerm("key:ttl-expired");
    expect(result).toBeNull();
  });

  it("does not expire keys stored without a TTL", async () => {
    const memory = new MemorySystem();

    await memory.storeShortTerm("key:no-ttl", "persistent");

    // Advance a very long time
    vi.advanceTimersByTime(1_000_000);

    const result = await memory.getShortTerm("key:no-ttl");
    expect(result).toBe("persistent");
  });
});

// ---------------------------------------------------------------------------
// 3. Redis fallback
// ---------------------------------------------------------------------------

describe("MemorySystem — Redis fallback", () => {
  it("falls back to in-memory Map when no Redis URL is provided", async () => {
    // Passing undefined explicitly → immediate fallback
    const memory = new MemorySystem(undefined);

    await memory.storeShortTerm("key:fallback-no-url", { data: 1 });
    const result = await memory.getShortTerm("key:fallback-no-url");

    expect(result).toEqual({ data: 1 });
  });

  it("falls back to in-memory Map when given an invalid Redis URL", async () => {
    // Port 9999 is almost certainly not running Redis; the connection will
    // fail and the MemorySystem should flip to the in-memory fallback.
    const memory = new MemorySystem("redis://localhost:9999");

    // Trigger a store — this will attempt Redis, fail, and switch to fallback.
    await memory.storeShortTerm("key:fallback-bad-url", { data: 2 });
    const result = await memory.getShortTerm("key:fallback-bad-url");

    expect(result).toEqual({ data: 2 });
  });
});

// ---------------------------------------------------------------------------
// 4. Cache miss
// ---------------------------------------------------------------------------

describe("MemorySystem — cache miss", () => {
  it("returns null for a key that was never stored", async () => {
    const memory = new MemorySystem();

    const result = await memory.getShortTerm("key:never-stored");
    expect(result).toBeNull();
  });

  it("returns null after a TTL-expired key is deleted from the map", async () => {
    vi.useFakeTimers();

    const memory = new MemorySystem();
    await memory.storeShortTerm("key:miss-after-expiry", "gone", 1);

    vi.advanceTimersByTime(2_000);

    const result = await memory.getShortTerm("key:miss-after-expiry");
    expect(result).toBeNull();

    vi.useRealTimers();
  });
});

// ---------------------------------------------------------------------------
// 5. Multiple keys don't interfere
// ---------------------------------------------------------------------------

describe("MemorySystem — multiple keys", () => {
  it("stores and retrieves two different keys independently", async () => {
    const memory = new MemorySystem();

    await memory.storeShortTerm("key:alpha", "value-alpha");
    await memory.storeShortTerm("key:beta", "value-beta");

    expect(await memory.getShortTerm("key:alpha")).toBe("value-alpha");
    expect(await memory.getShortTerm("key:beta")).toBe("value-beta");
  });

  it("overwriting one key does not affect another", async () => {
    const memory = new MemorySystem();

    await memory.storeShortTerm("key:x", "original-x");
    await memory.storeShortTerm("key:y", "original-y");

    // Overwrite key:x
    await memory.storeShortTerm("key:x", "updated-x");

    expect(await memory.getShortTerm("key:x")).toBe("updated-x");
    expect(await memory.getShortTerm("key:y")).toBe("original-y");
  });

  it("stores five distinct keys and retrieves each correctly", async () => {
    const memory = new MemorySystem();

    const entries = [
      ["key:1", 1],
      ["key:2", 2],
      ["key:3", 3],
      ["key:4", 4],
      ["key:5", 5],
    ] as const;

    for (const [k, v] of entries) {
      await memory.storeShortTerm(k, v);
    }

    for (const [k, v] of entries) {
      expect(await memory.getShortTerm(k)).toBe(v);
    }
  });
});
