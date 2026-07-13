"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import ForceGraph2D, { type ForceGraphMethods } from "react-force-graph-2d";
import { GraphData } from "@/lib/types";

interface KnowledgeGraphProps {
  data: GraphData;
}

type GraphNodeWithValue = {
  id: string;
  name: string;
  type: string;
  val: number;
  x?: number;
  y?: number;
};

const TYPE_COLORS: Record<string, string> = {
  equipment: "#3b82f6",
  regulation_clause: "#f97316",
  procedure: "#22c55e",
  location: "#a855f7",
  personnel: "#94a3b8",
};

export function KnowledgeGraph({ data }: KnowledgeGraphProps) {
  const fgRef = useRef<ForceGraphMethods<GraphNodeWithValue, { source: string; target: string }> | undefined>(undefined);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [dimensions, setDimensions] = useState({ width: 800, height: 600 });
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedNode, setSelectedNode] = useState<GraphNodeWithValue | null>(null);

  const safeNodes = Array.isArray(data?.nodes) ? data.nodes : [];
  const safeLinks = Array.isArray(data?.links) ? data.links : [];

  const nodes = useMemo(
    () =>
      safeNodes.map((node) => ({
        ...node,
        val: safeLinks.filter((link) => link.source === node.id || link.target === node.id).length + 1,
      })),
    [safeNodes, safeLinks]
  );

  const links = useMemo(() => safeLinks, [safeLinks]);
  const visibleNodes = useMemo(() => {
    if (!searchTerm.trim()) return nodes;
    return nodes.filter((node) => node.name.toLowerCase().includes(searchTerm.toLowerCase()));
  }, [nodes, searchTerm]);

  useEffect(() => {
    const updateSize = () => {
      if (!containerRef.current) return;
      setDimensions({
        width: containerRef.current.clientWidth,
        height: Math.max(500, containerRef.current.clientHeight),
      });
    };
    updateSize();
    window.addEventListener("resize", updateSize);
    return () => window.removeEventListener("resize", updateSize);
  }, []);

  useEffect(() => {
    if (selectedNode && fgRef.current) {
      fgRef.current.centerAt(selectedNode.x, selectedNode.y, 400);
      fgRef.current.zoom(1.4, 400);
    }
  }, [selectedNode]);

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 rounded-xl border border-slate-700 bg-surface p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-text-primary">Knowledge Graph</h2>
            <p className="text-sm text-text-secondary">Explore entities and relationships across your industrial corpus.</p>
          </div>
          <input
            value={searchTerm}
            onChange={(event) => setSearchTerm(event.target.value)}
            placeholder="Search entities"
            className="w-full rounded-lg border border-slate-700 bg-bg-elevated px-3 py-2 text-sm text-text-primary focus:border-accent-blue focus:outline-none sm:w-72"
          />
        </div>
        <div className="grid grid-cols-2 gap-2 text-xs text-text-secondary sm:grid-cols-3">
          {Object.entries(TYPE_COLORS).map(([type, color]) => (
            <div key={type} className="flex items-center gap-2">
              <span className="inline-block h-3 w-3 rounded-full" style={{ backgroundColor: color }} />
              <span>{type.replace("_", " ")}</span>
            </div>
          ))}
        </div>
      </div>

      <div ref={containerRef} className="relative h-[60vh] rounded-xl border border-slate-700 bg-surface">
        <ForceGraph2D
          ref={fgRef}
          graphData={{ nodes: visibleNodes, links: links.filter((link) => visibleNodes.some((node) => node.id === link.source || node.id === link.target)) }}
          nodeAutoColorBy="type"
          nodeCanvasObject={(node: GraphNodeWithValue, ctx, globalScale) => {
            const label = node.name;
            const fontSize = 10 + node.val * 0.7;
            ctx.fillStyle = TYPE_COLORS[node.type] ?? "#94a3b8";
            ctx.beginPath();
            ctx.arc(node.x ?? 0, node.y ?? 0, Math.max(4, node.val), 0, 2 * Math.PI, false);
            ctx.fill();
            ctx.font = `${fontSize}px Sans-Serif`;
            ctx.fillStyle = "#f8fafc";
            ctx.textAlign = "center";
            ctx.fillText(label, node.x ?? 0, (node.y ?? 0) - Math.max(8, node.val));
          }}
          linkDirectionalArrowLength={3}
          linkDirectionalArrowRelPos={1}
          linkWidth={1.5}
          nodeRelSize={4}
          onNodeClick={(node) => setSelectedNode(node as GraphNodeWithValue)}
          cooldownTicks={100}
          backgroundColor="#0a0a0f"
          width={dimensions.width}
          height={dimensions.height}
        />
      </div>

      {selectedNode ? (
        <div className="rounded-xl border border-slate-700 bg-surface p-4">
          <h3 className="text-base font-semibold text-text-primary">Entity details</h3>
          <p className="mt-2 text-sm text-text-secondary">Name: {selectedNode.name}</p>
          <p className="mt-1 text-sm text-text-secondary">Type: {selectedNode.type}</p>
          <p className="mt-1 text-sm text-text-secondary">Connections: {selectedNode.val - 1}</p>
        </div>
      ) : null}
    </div>
  );
}
