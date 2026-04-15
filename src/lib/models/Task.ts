import mongoose, { Document, Model, Schema, Types } from "mongoose";
import type { FinalResult } from "@/types/index";

// ---------------------------------------------------------------------------
// TypeScript interface
// ---------------------------------------------------------------------------

export interface ITask extends Document {
  _id: Types.ObjectId;
  userQuery: string;
  status:
    | "pending"
    | "planning"
    | "executing"
    | "reviewing"
    | "completed"
    | "failed";
  steps: Types.ObjectId[];
  finalResult?: FinalResult;
  errorMessage?: string;
  createdAt: Date;
  updatedAt: Date;
}

// ---------------------------------------------------------------------------
// Mongoose schema
// ---------------------------------------------------------------------------

const TaskSchema = new Schema<ITask>(
  {
    userQuery: {
      type: String,
      required: [true, "userQuery is required"],
      trim: true,
      minlength: [1, "userQuery must not be empty"],
      maxlength: [2000, "userQuery must not exceed 2000 characters"],
    },
    status: {
      type: String,
      required: [true, "status is required"],
      enum: {
        values: [
          "pending",
          "planning",
          "executing",
          "reviewing",
          "completed",
          "failed",
        ],
        message: "status must be one of: pending, planning, executing, reviewing, completed, failed",
      },
      default: "pending",
    },
    steps: {
      type: [{ type: Schema.Types.ObjectId, ref: "Step" }],
      default: [],
    },
    finalResult: {
      type: Schema.Types.Mixed,
      required: false,
    },
    errorMessage: {
      type: String,
      required: false,
    },
  },
  {
    timestamps: true, // adds createdAt and updatedAt automatically
  }
);

// _id index is added automatically by Mongoose; explicitly declare it here
// for documentation and to satisfy the spec requirement.
TaskSchema.index({ _id: 1 });

// ---------------------------------------------------------------------------
// Model (safe for Next.js hot reload)
// ---------------------------------------------------------------------------

const Task: Model<ITask> =
  (mongoose.models.Task as Model<ITask>) ||
  mongoose.model<ITask>("Task", TaskSchema);

export default Task;
