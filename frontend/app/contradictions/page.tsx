"use client";

import { useEffect, useState } from "react";
import { ContradictionList } from "@/components/ContradictionList";
import { Contradiction } from "@/lib/types";

export default function ContradictionsPage() {
  const [contradictions, setContradictions] = useState<Contradiction[]>([]);
  const [filter, setFilter] = useState<"all" | "high" | "medium" | "low">("all");
  const [isRunning, setIsRunning] = useState(false);
  const [runStatus, setRunStatus] = useState<{ type: "success" | "error"; message: string } | null>(null);

  const fetchContradictions = async (severity?: string) => {
    const url = severity ? `/api/contradictions?severity=${severity}` : "/api/contradictions";
    const response = await fetch(url);
    const data = await response.json();
    setContradictions(Array.isArray(data) ? data : []);
  };

  useEffect(() => {
    fetchContradictions();
  }, []);

  const handleRunDetector = async () => {
    setIsRunning(true);
    setRunStatus(null);
    try {
      const response = await fetch("/api/contradictions/run", { method: "POST" });
      const payload = await response.json();

      if (!response.ok || payload.error) {
        setRunStatus({ type: "error", message: payload.error || payload.message || "Detector run failed." });
      } else if (payload.success === false) {
        setRunStatus({ type: "error", message: payload.message || "Detector could not run." });
      } else {
        const outputLines = (payload.output || "").trim().split("\n");
        const lastLine = outputLines[outputLines.length - 1] || "Detector ran successfully.";
        setRunStatus({ type: "success", message: lastLine });
      }

      await fetchContradictions(filter === "all" ? undefined : filter);
    } catch (error: unknown) {
      setRunStatus({ type: "error", message: (error as Error).message });
    } finally {
      setIsRunning(false);
    }
  };

  return (
    <main className="min-h-screen bg-primary px-4 py-6 lg:px-10">
      <div className="mx-auto max-w-7xl">
        <div className="mb-6 rounded-xl border border-slate-700 bg-bg-elevated p-4">
          <h1 className="text-2xl font-semibold text-text-primary">{contradictions.length} contradictions detected</h1>
          <p className="mt-2 text-sm text-text-secondary">Review the latest conflict findings across your corpus.</p>
        </div>

        {isRunning ? (
          <div className="mb-4 rounded-xl border border-slate-700 bg-bg-elevated p-4 text-sm text-text-secondary">
            Running contradiction detector — this can take a minute...
          </div>
        ) : null}

        {runStatus ? (
          <div
            className={`mb-4 rounded-xl border p-4 text-sm ${
              runStatus.type === "success"
                ? "border-green-700 bg-green-950/40 text-green-300"
                : "border-red-700 bg-red-950/40 text-red-300"
            }`}
          >
            {runStatus.message}
          </div>
        ) : null}

        <ContradictionList
          contradictions={contradictions}
          activeSeverity={filter}
          onSeverityChange={(severity) => {
            setFilter(severity);
            fetchContradictions(severity === "all" ? undefined : severity);
          }}
          onRunDetector={handleRunDetector}
        />
      </div>
    </main>
  );
}