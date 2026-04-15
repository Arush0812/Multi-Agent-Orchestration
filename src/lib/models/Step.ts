import mongoose, { Document, Model, Schema, Types } from "mongoose";
import type { ToolName, JSONSchema } from "@/types/index";

// ---------------------------------------------------------------------------
// TypeScript interface
// ---------------------------------------------------------------------------

export interface IStep extends Document {
  _id: Types.ObjectId;
  taskId: Types.ObjectId;
  description: string;
  order: number;
  status: "pending" | "executing" | "completed" | "failed" | "skipped";
  suggestedTool: ToolName | null;
  expectedOutputSchema: JSONSchema;
  executions: Types.ObjectId[];
  finalExecutionId?: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

// ---------------------------------------------------------------------------
// Mongoose schema
// ---------------------------------------------------------------------------

const StepSchema = new Schema<IStep>(
  {
    taskId: {
      type: Schema.Types.ObjectId,
      ref: "Task",
      required: [true, "taskId is required"],
    },
    description: {
      type: String,
      required: [true, "description is required"],
      trim: true,
      minlength: [1, "description must not be empty"],
    },
    order: {
      type: Number,
      required: [true, "order is required"],
      min: [0, "order must be a non-negative integer"],
      validate: {
        validator: (v: number) => Number.isInteger(v),
        message: "order must be an integer",
      },
    },
    status: {
      type: String,
      required: [true, "status is required"],
      enum: {
        values: ["pending", "executing", "completed", "failed", "skipped"],
        message:
          "status must be one of: pending, executing, completed, failed, skipped",
      },
      default: "pending",
    },
    suggestedTool: {
      type: String,
      enum: {
        values: ["web_search", "web_scraper", "calculator"],
        message: "suggestedTool must be a valid ToolName",
      },
      default: null,
      required: false,
    },
    expectedOutputSchema: {
      type: Schema.Types.Mixed,
      required: [true, "expectedOutputSchema is required"],
    },
    executions: {
      type: [{ type: Schema.Types.ObjectId, ref: "Execution" }],
      default: [],
    },
    finalExecutionId: {
      type: Schema.Types.ObjectId,
      ref: "Execution",
      required: false,
    },
  },
  {
    timestamps: true, // adds createdAt and updatedAt automatically
  }
);

// Compound unique index: order must be unique within a task
StepSchema.index({ taskId: 1, order: 1 }, { unique: true });

// ---------------------------------------------------------------------------
// Model (safe for Next.js hot reload)
// ---------------------------------------------------------------------------

const Step: Model<IStep> =
  (mongoose.models.Step as Model<IStep>) ||
  mongoose.model<IStep>("Step", StepSchema);

export default Step;
