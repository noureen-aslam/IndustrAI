"use client";

import { useEffect, useState } from "react";
import { ContradictionList } from "@/components/ContradictionList";
import { Contradiction } from "@/lib/types";

export default function ContradictionsPage() {
  const [contradictions, setContradictions] = useState<Contradiction[]>([]);
  const [filter, setFilter] = useState<"all" | "high" | "medium" | "low">("all");

  const fetchContradictions = async (severity?: string) => {
    const url = severity ? `/api/contradictions?severity=${severity}` : "/api/contradictions";
    const response = await fetch(url);
    const data = await response.json();
    setContradictions(data ?? []);
  };

  useEffect(() => {
    fetchContradictions();
  }, []);

  const handleRunDetector = async () => {
    await fetch("/api/contradictions/run", { method: "POST" });
    fetchContradictions(filter === "all" ? undefined : filter);
  };

  return (
    <main className="min-h-screen bg-primary px-4 py-6 lg:px-10">
      <div className="mx-auto max-w-7xl">
        <div className="mb-6 rounded-xl border border-slate-700 bg-bg-elevated p-4">
          <h1 className="text-2xl font-semibold text-text-primary">{contradictions.length} contradictions detected</h1>
          <p className="mt-2 text-sm text-text-secondary">Review the latest conflict findings across your corpus.</p>
        </div>
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
