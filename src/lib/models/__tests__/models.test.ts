/**
 * Unit tests for Mongoose model schema validation.
 *
 * Uses validateSync() — no DB connection required.
 */

import { describe, it, expect } from "vitest";
import mongoose from "mongoose";
import Task from "../Task";
import Step from "../Step";
import Execution from "../Execution";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const validTaskId = new mongoose.Types.ObjectId();
const validStepId = new mongoose.Types.ObjectId();

// ---------------------------------------------------------------------------
// Task model
// ---------------------------------------------------------------------------

describe("Task model validation", () => {
  it("should fail when userQuery exceeds 2000 characters", () => {
    const doc = new Task({ userQuery: "a".repeat(2001), status: "pending" });
    const err = doc.validateSync();
    expect(err).toBeDefined();
    expect(err?.errors["userQuery"]).toBeDefined();
  });

  it("should fail when userQuery is an empty string", () => {
    const doc = new Task({ userQuery: "", status: "pending" });
    const err = doc.validateSync();
    expect(err).toBeDefined();
    expect(err?.errors["userQuery"]).toBeDefined();
  });

  it("should fail when status has an invalid value", () => {
    const doc = new Task({ userQuery: "What is AI?", status: "unknown" });
    const err = doc.validateSync();
    expect(err).toBeDefined();
    expect(err?.errors["status"]).toBeDefined();
  });

  it("should pass validation for a valid task document", () => {
    const doc = new Task({ userQuery: "What is AI?", status: "pending" });
    const err = doc.validateSync();
    expect(err).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Step model
// ---------------------------------------------------------------------------

describe("Step model validation", () => {
  const validStepBase = {
    taskId: validTaskId,
    description: "Search for relevant papers",
    order: 1,
    status: "pending",
    expectedOutputSchema: { type: "object" },
  };

  it("should fail when order is negative (-1)", () => {
    const doc = new Step({ ...validStepBase, order: -1 });
    const err = doc.validateSync();
    expect(err).toBeDefined();
    expect(err?.errors["order"]).toBeDefined();
  });

  it("should fail when order is a non-integer (1.5)", () => {
    const doc = new Step({ ...validStepBase, order: 1.5 });
    const err = doc.validateSync();
    expect(err).toBeDefined();
    expect(err?.errors["order"]).toBeDefined();
  });

  it("should fail when description is an empty string", () => {
    const doc = new Step({ ...validStepBase, description: "" });
    const err = doc.validateSync();
    expect(err).toBeDefined();
    expect(err?.errors["description"]).toBeDefined();
  });

  it("should fail when status has an invalid value", () => {
    const doc = new Step({ ...validStepBase, status: "unknown" });
    const err = doc.validateSync();
    expect(err).toBeDefined();
    expect(err?.errors["status"]).toBeDefined();
  });

  it("should pass validation for a valid step document", () => {
    const doc = new Step(validStepBase);
    const err = doc.validateSync();
    expect(err).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Execution model
// ---------------------------------------------------------------------------

describe("Execution model validation", () => {
  const validExecutionBase = {
    stepId: validStepId,
    attempt: 1,
    toolUsed: "web_search",
    input: { query: "AI frameworks 2024" },
    status: "success",
    confidence: 0.9,
  };

  it("should fail when attempt is 0", () => {
    const doc = new Execution({ ...validExecutionBase, attempt: 0 });
    const err = doc.validateSync();
    expect(err).toBeDefined();
    expect(err?.errors["attempt"]).toBeDefined();
  });

  it("should fail when confidence is below 0 (-0.1)", () => {
    const doc = new Execution({ ...validExecutionBase, confidence: -0.1 });
    const err = doc.validateSync();
    expect(err).toBeDefined();
    expect(err?.errors["confidence"]).toBeDefined();
  });

  it("should fail when confidence exceeds 1 (1.1)", () => {
    const doc = new Execution({ ...validExecutionBase, confidence: 1.1 });
    const err = doc.validateSync();
    expect(err).toBeDefined();
    expect(err?.errors["confidence"]).toBeDefined();
  });

  it("should fail when status has an invalid value", () => {
    const doc = new Execution({ ...validExecutionBase, status: "unknown" });
    const err = doc.validateSync();
    expect(err).toBeDefined();
    expect(err?.errors["status"]).toBeDefined();
  });

  it("should pass validation for a valid execution document", () => {
    const doc = new Execution(validExecutionBase);
    const err = doc.validateSync();
    expect(err).toBeUndefined();
  });
});
