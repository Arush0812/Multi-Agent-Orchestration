"use client";

import { useEffect, useRef, useState } from "react";

// ---------------------------------------------------------------------------
// SSE event types
// ---------------------------------------------------------------------------

interface StepEvent {
  type: "step";
  stepId: string;
  status: "completed" | "failed";
  stepIndex: number;
  totalSteps: number;
}

interface ResultEvent {
  type: "result";
  summary: string;
  data: unknown;
  stepResults: unknown[];
}

interface ErrorEvent {
  type: "error";
  message: string;
}

type SSEEvent = StepEvent | ResultEvent | ErrorEvent;

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function StatusBadge({ status }: { status: "completed" | "failed" }) {
  const base = "inline-block rounded-full px-2 py-0.5 text-xs font-semibold";
  if (status === "completed") {
    return (
      <span className={`${base} bg-green-100 text-green-800`}>completed</span>
    );
  }
  return <span className={`${base} bg-red-100 text-red-800`}>failed</span>;
}

// ---------------------------------------------------------------------------
// TaskProgress
// ---------------------------------------------------------------------------

export default function TaskProgress({ taskId }: { taskId: string }) {
  const [steps, setSteps] = useState<StepEvent[]>([]);
  const [result, setResult] = useState<ResultEvent | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const esRef = useRef<EventSource | null>(null);

  useEffect(() => {
    if (!taskId) return;

    const es = new EventSource(`/api/tasks/${taskId}/result`);
    esRef.current = es;

    es.onmessage = (event: MessageEvent) => {
      let parsed: SSEEvent;
      try {
        parsed = JSON.parse(event.data as string) as SSEEvent;
      } catch {
        return;
      }

      if (parsed.type === "step") {
        setSteps((prev) => {
          // Avoid duplicates
          if (prev.some((s) => s.stepId === parsed.stepId)) return prev;
          return [...prev, parsed as StepEvent];
        });
      } else if (parsed.type === "result") {
        setResult(parsed as ResultEvent);
        setDone(true);
        es.close();
      } else if (parsed.type === "error") {
        setError((parsed as ErrorEvent).message);
        setDone(true);
        es.close();
      }
    };

    es.onerror = () => {
      if (!done) {
        setError("Connection lost. The task may still be running.");
      }
      es.close();
    };

    return () => {
      es.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taskId]);

  // Render a safe text value for unknown data
  function safeText(value: unknown): string {
    if (value === null || value === undefined) return "";
    if (typeof value === "string") return value;
    return JSON.stringify(value, null, 2);
  }

  return (
    <div className="mt-8 w-full space-y-6">
      {/* Steps */}
      {steps.length > 0 && (
        <section>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-zinc-500">
            Steps
          </h2>
          <ul className="space-y-2">
            {steps.map((step) => (
              <li
                key={step.stepId}
                className="flex items-center justify-between rounded-lg border border-zinc-200 bg-white px-4 py-3 shadow-sm"
              >
                <span className="text-sm text-zinc-700">
                  Step {step.stepIndex + 1}
                  {step.totalSteps > 0 && (
                    <span className="text-zinc-400"> / {step.totalSteps}</span>
                  )}
                </span>
                <StatusBadge status={step.status} />
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* In-progress indicator */}
      {!done && steps.length === 0 && (
        <p className="text-sm text-zinc-500">Waiting for steps…</p>
      )}

      {!done && steps.length > 0 && (
        <p className="text-sm text-zinc-400">Processing…</p>
      )}

      {/* Final result */}
      {result && (
        <section className="rounded-lg border border-green-200 bg-green-50 p-5">
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-green-700">
            Result
          </h2>
          {result.summary && (
            <p className="mb-3 text-sm text-zinc-800">{result.summary}</p>
          )}
          {result.data !== null && result.data !== undefined && (
            <pre className="overflow-x-auto rounded bg-white p-3 text-xs text-zinc-700 shadow-inner">
              {safeText(result.data)}
            </pre>
          )}
        </section>
      )}

      {/* Error state */}
      {error && (
        <section className="rounded-lg border border-red-200 bg-red-50 p-4">
          <p className="text-sm font-medium text-red-700">{error}</p>
        </section>
      )}
    </div>
  );
}
