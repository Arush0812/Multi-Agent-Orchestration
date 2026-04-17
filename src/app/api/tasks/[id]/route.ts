import { NextRequest } from "next/server";
import { connectDB } from "@/lib/db";
import { orchestrator } from "@/lib/container";
import Task from "@/lib/models/Task";

// ---------------------------------------------------------------------------
// GET /api/tasks/[id]
// ---------------------------------------------------------------------------

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: taskId } = await params;

  await connectDB();

  // If orchestrator is wired, use it; otherwise fall back to direct DB query
  let task;
  try {
    if (orchestrator) {
      task = await orchestrator.getTaskStatus(taskId);
    } else {
      task = await Task.findById(taskId).populate("steps");
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes("not found") || message.includes("Cast to ObjectId")) {
      return Response.json({ error: "Task not found" }, { status: 404 });
    }
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }

  if (!task) {
    return Response.json({ error: "Task not found" }, { status: 404 });
  }

  // Build progress fraction from populated steps
  const steps = Array.isArray(task.steps) ? task.steps : [];
  const total = steps.length;
  const completed = steps.filter(
    (s: { status?: string }) => s.status === "completed"
  ).length;

  return Response.json({
    taskId: task._id.toString(),
    status: task.status,
    steps: steps,
    progress: { completed, total },
  });
}
