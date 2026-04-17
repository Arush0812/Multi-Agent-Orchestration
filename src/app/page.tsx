"use client";

import { useState } from "react";
import TaskProgress from "@/components/TaskProgress";

export default function Home() {
  const [userQuery, setUserQuery] = useState("");
  const [taskId, setTaskId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setTaskId(null);
    setLoading(true);

    try {
      const res = await fetch("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userQuery }),
      });

      if (!res.ok) {
        let message = `Request failed (${res.status})`;
        try {
          const body = (await res.json()) as { error?: string };
          if (body.error) message = body.error;
        } catch {
          // ignore parse error
        }
        setError(message);
        return;
      }

      const data = (await res.json()) as { taskId: string };
      setTaskId(data.taskId);
      setUserQuery("");
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen flex-col items-center bg-zinc-50 px-4 py-16">
      <div className="w-full max-w-2xl">
        <h1 className="mb-8 text-2xl font-semibold tracking-tight text-zinc-900">
          Multi-Agent Task Runner
        </h1>

        <form onSubmit={handleSubmit} className="space-y-4">
          <textarea
            value={userQuery}
            onChange={(e) => setUserQuery(e.target.value)}
            placeholder="Describe your task..."
            rows={4}
            required
            disabled={loading}
            className="w-full resize-none rounded-lg border border-zinc-300 bg-white px-4 py-3 text-sm text-zinc-900 shadow-sm placeholder:text-zinc-400 focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500 disabled:opacity-50"
          />

          {error && (
            <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={loading || !userQuery.trim()}
            className="flex w-full items-center justify-center rounded-lg bg-zinc-900 px-5 py-3 text-sm font-medium text-white transition-colors hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {loading ? (
              <span className="flex items-center gap-2">
                <svg
                  className="h-4 w-4 animate-spin"
                  viewBox="0 0 24 24"
                  fill="none"
                  aria-hidden="true"
                >
                  <circle
                    className="opacity-25"
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    strokeWidth="4"
                  />
                  <path
                    className="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"
                  />
                </svg>
                Submitting…
              </span>
            ) : (
              "Submit Task"
            )}
          </button>
        </form>

        {taskId && <TaskProgress taskId={taskId} />}
      </div>
    </div>
  );
}
