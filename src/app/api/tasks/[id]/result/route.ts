import { NextRequest } from "next/server";
import { connectDB } from "@/lib/db";
import Task from "@/lib/models/Task";
import Step from "@/lib/models/Step";

// ---------------------------------------------------------------------------
// SSE helper
// ---------------------------------------------------------------------------

function sseEvent(data: object): Uint8Array {
  return new TextEncoder().encode(`data: ${JSON.stringify(data)}\n\n`);
}

// ---------------------------------------------------------------------------
// GET /api/tasks/[id]/result
// ---------------------------------------------------------------------------

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: taskId } = await params;

  const stream = new ReadableStream({
    async start(controller) {
      // Connect to MongoDB once before polling
      try {
        await connectDB();
      } catch {
        controller.enqueue(
          sseEvent({ type: "error", message: "Database connection failed" })
        );
        controller.close();
        return;
      }

      // Track which step IDs have already been sent to avoid duplicates
      const sentStepIds = new Set<string>();

      // Poll up to 300 times (5 minutes at 1s intervals)
      const MAX_POLLS = 300;

      for (let poll = 0; poll < MAX_POLLS; poll++) {
        // Respect client disconnect
        if (request.signal.aborted) {
          controller.close();
          return;
        }

        let task;
        try {
          task = await Task.findById(taskId).populate("steps");
        } catch {
          controller.enqueue(
            sseEvent({ type: "error", message: "Failed to fetch task" })
          );
          controller.close();
          return;
        }

        if (!task) {
          controller.enqueue(
            sseEvent({ type: "error", message: "Task not found" })
          );
          controller.close();
          return;
        }

        // Emit events for any newly completed/failed steps
        const steps = Array.isArray(task.steps) ? task.steps : [];
        const totalSteps = steps.length;

        for (let i = 0; i < steps.length; i++) {
          const step = steps[i] as InstanceType<typeof Step>;
          const stepId = step._id.toString();

          if (
            !sentStepIds.has(stepId) &&
            (step.status === "completed" || step.status === "failed")
          ) {
            sentStepIds.add(stepId);
            controller.enqueue(
              sseEvent({
                type: "step",
                stepId,
                status: step.status,
                stepIndex: i,
                totalSteps,
              })
            );
          }
        }

        // Check terminal task states
        if (task.status === "completed") {
          controller.enqueue(
            sseEvent({
              type: "result",
              summary: task.finalResult?.summary ?? "",
              data: task.finalResult?.data ?? null,
              stepResults: task.finalResult?.stepResults ?? [],
            })
          );
          controller.close();
          return;
        }

        if (task.status === "failed") {
          controller.enqueue(
            sseEvent({
              type: "error",
              message: task.errorMessage ?? "Task failed",
            })
          );
          controller.close();
          return;
        }

        // Wait 1 second before next poll (unless client disconnected)
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(resolve, 1000);
          request.signal.addEventListener("abort", () => {
            clearTimeout(timer);
            reject(new Error("aborted"));
          });
        }).catch(() => {
          // Client disconnected during sleep
        });

        if (request.signal.aborted) {
          controller.close();
          return;
        }
      }

      // Timeout after MAX_POLLS
      controller.enqueue(
        sseEvent({ type: "error", message: "Stream timed out after 5 minutes" })
      );
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
