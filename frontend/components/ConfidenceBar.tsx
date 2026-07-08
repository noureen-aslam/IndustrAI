interface ConfidenceBarProps {
  confidence: number;
}

export function ConfidenceBar({ confidence }: ConfidenceBarProps) {
  const percent = Math.round(confidence * 100);
  const color = confidence >= 0.7 ? "bg-emerald-500" : confidence >= 0.4 ? "bg-amber-400" : "bg-red-500";

  return (
    <div className="mt-3">
      <div className="mb-2 flex items-center justify-between text-xs uppercase tracking-wide text-text-secondary">
        <span>Confidence</span>
        <span>{percent}%</span>
      </div>
      <div className="h-3 overflow-hidden rounded-full bg-slate-800">
        <div
          className={`${color} h-full transition-all duration-500 ease-out`}
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
}
