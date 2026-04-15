import mongoose, { Document, Model, Schema, Types } from "mongoose";
import type { ToolName, ReviewDecision } from "@/types/index";

// ---------------------------------------------------------------------------
// TypeScript interface
// ---------------------------------------------------------------------------

export interface IExecution extends Document {
  _id: Types.ObjectId;
  stepId: Types.ObjectId;
  attempt: number;
  toolUsed: ToolName;
  input: Record<string, unknown>;
  output?: unknown;
  status: "success" | "failure";
  reviewDecision?: ReviewDecision;
  logs: string[];
  confidence: number;
  createdAt: Date;
}

// ---------------------------------------------------------------------------
// Mongoose schema
// ---------------------------------------------------------------------------

const ExecutionSchema = new Schema<IExecution>(
  {
    stepId: {
      type: Schema.Types.ObjectId,
      ref: "Step",
      required: [true, "stepId is required"],
    },
    attempt: {
      type: Number,
      required: [true, "attempt is required"],
      min: [1, "attempt must be at least 1"],
    },
    toolUsed: {
      type: String,
      required: [true, "toolUsed is required"],
      enum: {
        values: ["web_search", "web_scraper", "calculator"],
        message: "toolUsed must be a valid ToolName",
      },
    },
    input: {
      type: Schema.Types.Mixed,
      required: [true, "input is required"],
    },
    output: {
      type: Schema.Types.Mixed,
      required: false,
    },
    status: {
      type: String,
      required: [true, "status is required"],
      enum: {
        values: ["success", "failure"],
        message: 'status must be "success" or "failure"',
      },
    },
    reviewDecision: {
      type: Schema.Types.Mixed,
      required: false,
    },
    logs: {
      type: [String],
      default: [],
    },
    confidence: {
      type: Number,
      required: [true, "confidence is required"],
      min: [0, "confidence must be at least 0"],
      max: [1, "confidence must be at most 1"],
    },
  },
  {
    timestamps: true, // adds createdAt and updatedAt automatically
  }
);

// Index for efficient lookup by step
ExecutionSchema.index({ stepId: 1 });

// ---------------------------------------------------------------------------
// Model (safe for Next.js hot reload)
// ---------------------------------------------------------------------------

const Execution: Model<IExecution> =
  (mongoose.models.Execution as Model<IExecution>) ||
  mongoose.model<IExecution>("Execution", ExecutionSchema);

export default Execution;
