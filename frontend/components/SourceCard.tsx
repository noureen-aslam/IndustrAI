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

// Must match sanitize_filename() in pipeline/upload_pdfs_to_storage.py exactly,
// so generated URLs match the actual Storage object keys.
function sanitizeFilename(filename: string): string {
  return filename
    .replace(/\u2014/g, "-") // em dash
    .replace(/\u2013/g, "-") // en dash
    .replace(/\s+/g, " ")
    .trim();
}

export function SourceCard({ docId, page, similarity, docType, filename }: SourceCardProps) {
  const badgeClass = BADGE_COLORS[docType] ?? BADGE_COLORS.default;
  const sourceUrl = useMemo(() => {
    const safeName = sanitizeFilename(filename);
    return `https://${process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/^https?:\/\//, "")}/storage/v1/object/public/documents/${encodeURIComponent(docType)}/${encodeURIComponent(safeName)}`;
  }, [docType, filename]);

  return (
    <div className="rounded-[24px] border border-slate-700 bg-slate-950/90 p-4 shadow-sm transition hover:-translate-y-0.5 hover:border-slate-500">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-text-primary truncate">{filename}</p>
          <p className="mt-1 text-[11px] uppercase tracking-[0.24em] text-text-secondary">
            {docType.replace(/_/g, " ")}
          </p>
        </div>
        <span className={`rounded-full px-2 py-1 text-[11px] font-semibold text-white ${badgeClass}`}>
          {docType}
        </span>
      </div>

      <div className="mt-4 grid gap-2 text-sm text-text-secondary">
        <p>Page {page}</p>
        <p>Similarity {Math.round(similarity * 100)}%</p>
      </div>

      <a
        href={sourceUrl}
        target="_blank"
        rel="noreferrer"
        className="mt-4 inline-flex items-center gap-2 text-sm font-medium text-accent-blue transition hover:text-white"
      >
        Open source document
      </a>
    </div>
  );
}