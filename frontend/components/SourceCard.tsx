import { useMemo } from "react";

interface SourceCardProps {
  docId: string;
  page: number;
  similarity: number;
  docType: string;
  filename: string;
}

const BADGE_COLORS: Record<string, string> = {
  regulatory: "bg-orange-500",
  manuals: "bg-blue-500",
  inspection_forms: "bg-green-500",
  pid_samples: "bg-purple-500",
  default: "bg-slate-500",
};

export function SourceCard({ docId, page, similarity, docType, filename }: SourceCardProps) {
  const badgeClass = BADGE_COLORS[docType] ?? BADGE_COLORS.default;
  const sourceUrl = useMemo(() => {
    return `https://${process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/^https?:\/\//, "")}/storage/v1/object/public/documents/${encodeURIComponent(docType)}/${encodeURIComponent(filename)}`;
  }, [docType, filename]);

  return (
    <div className="rounded-xl border border-slate-700 bg-surface p-4">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-semibold text-text-primary">{filename}</span>
        <span className={`rounded-full px-2 py-1 text-[11px] text-white ${badgeClass}`}>{docType}</span>
      </div>
      <p className="mt-2 text-sm text-text-secondary">Page {page}</p>
      <p className="mt-1 text-sm text-text-secondary">Similarity {Math.round(similarity * 100)}%</p>
      <a href={sourceUrl} target="_blank" rel="noreferrer" className="mt-3 inline-block text-sm font-medium text-accent-blue hover:text-white">
        Open source document
      </a>
    </div>
  );
}
