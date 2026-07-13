import { Contradiction } from "@/lib/types";

interface ContradictionListProps {
  contradictions: Contradiction[];
  activeSeverity: "all" | "high" | "medium" | "low";
  onSeverityChange: (severity: "all" | "high" | "medium" | "low") => void;
  onRunDetector: () => void;
}

const BADGE_CLASSES: Record<string, string> = {
  high: "bg-red-500 text-white",
  medium: "bg-amber-400 text-black",
  low: "bg-slate-500 text-white",
};

export function ContradictionList({
  contradictions,
  activeSeverity,
  onSeverityChange,
  onRunDetector,
}: ContradictionListProps) {
  const safeContradictions = Array.isArray(contradictions) ? contradictions : [];
  const filtered = safeContradictions.filter((item) => activeSeverity === "all" || item.severity === activeSeverity);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 rounded-xl border border-slate-700 bg-surface p-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold text-text-primary">Contradictions</h2>
          <p className="text-sm text-text-secondary">Review conflicts detected across your document corpus.</p>
        </div>
        <button
          type="button"
          onClick={onRunDetector}
          className="rounded-lg bg-accent-orange px-4 py-2 text-sm font-semibold text-black hover:bg-orange-400"
        >
          Run detector
        </button>
      </div>

      <div className="flex flex-wrap gap-2">
        {(["all", "high", "medium", "low"] as const).map((severity) => (
          <button
            key={severity}
            onClick={() => onSeverityChange(severity)}
            className={`rounded-lg border px-3 py-2 text-sm ${activeSeverity === severity ? "border-white bg-slate-800 text-text-primary" : "border-slate-700 bg-bg-elevated text-text-secondary"}`}
          >
            {severity === "all" ? "All" : severity.charAt(0).toUpperCase() + severity.slice(1)}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-xl border border-slate-700 bg-surface p-6 text-center text-text-secondary">
          No contradictions detected yet. Run the detector to analyze your document corpus.
        </div>
      ) : (
        <div className="space-y-4">
          {filtered.map((item) => (
            <div key={item.contradiction_id} className="rounded-xl border border-slate-700 bg-surface p-5">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h3 className="text-base font-semibold text-text-primary">{item.entity_name}</h3>
                  <p className="text-sm text-text-secondary">{item.claim_type.replace("_", " ")}</p>
                </div>
                <span className={`rounded-full px-3 py-1 text-xs font-semibold ${BADGE_CLASSES[item.severity]}`}>
                  {item.severity.toUpperCase()}
                </span>
              </div>

              <div className="mt-4 grid gap-4 md:grid-cols-2">
                <div className="rounded-xl border border-slate-700 bg-bg-elevated p-4">
                  <h4 className="text-sm font-semibold text-text-primary">Source A</h4>
                  <p className="mt-2 text-sm text-text-secondary">{item.doc_id_a} • page {item.page_a}</p>
                  <p className="mt-3 text-sm text-text-primary">{item.claim_a}</p>
                </div>
                <div className="rounded-xl border border-slate-700 bg-bg-elevated p-4">
                  <h4 className="text-sm font-semibold text-text-primary">Source B</h4>
                  <p className="mt-2 text-sm text-text-secondary">{item.doc_id_b} • page {item.page_b}</p>
                  <p className="mt-3 text-sm text-text-primary">{item.claim_b}</p>
                </div>
              </div>

              <p className="mt-4 italic text-sm text-text-secondary">{item.reason}</p>
              <p className="mt-2 text-xs uppercase tracking-wide text-text-secondary">Detected {new Date(item.detected_at).toLocaleString()}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
