"use client";

import { useEffect, useState } from "react";
import { KnowledgeGraph } from "@/components/KnowledgeGraph";
import { GraphData } from "@/lib/types";

export default function GraphPage() {
  const [graphData, setGraphData] = useState<GraphData>({ nodes: [], links: [] });

  useEffect(() => {
    fetch("/api/graph")
      .then((response) => response.json())
      .then((data) => {
        if (!data || !Array.isArray(data.nodes) || !Array.isArray(data.links)) {
          setGraphData({ nodes: [], links: [] });
          return;
        }
        setGraphData(data);
      })
      .catch(() => setGraphData({ nodes: [], links: [] }));
  }, []);

  return (
    <main className="min-h-screen bg-primary px-4 py-6 lg:px-10">
      <div className="mx-auto max-w-7xl">
        <KnowledgeGraph data={graphData} />
      </div>
    </main>
  );
}
