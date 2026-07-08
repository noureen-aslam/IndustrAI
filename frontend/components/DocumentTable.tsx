"use client";

import { useMemo } from "react";
import { Document } from "@/lib/types";

interface DocumentTableProps {
  documents: Document[];
  onReingest?: (docId: string) => Promise<void>;
}

export function DocumentTable({ documents, onReingest }: DocumentTableProps) {
  const sortedDocuments = useMemo(
    () => [...documents].sort((a, b) => (a.processed_at < b.processed_at ? 1 : -1)),
    [documents]
  );

  if (!sortedDocuments.length) {
    return (
      <div className="rounded-xl border border-slate-700 bg-surface p-6 text-center text-text-secondary">
        No documents ingested yet. Upload your first document above.
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-xl border border-slate-700 bg-surface">
      <div className="hidden grid-cols-7 gap-4 border-b border-slate-700 px-6 py-4 text-xs uppercase tracking-wide text-text-secondary sm:grid">
        <div>Filename</div>
        <div>Type</div>
        <div>Pages</div>
        <div>Method</div>
        <div>Chunks</div>
        <div>Uploaded At</div>
        <div>Actions</div>
      </div>
      <div className="divide-y divide-slate-700">
        {sortedDocuments.map((document) => (
          <div key={document.doc_id} className="grid gap-4 px-6 py-4 text-sm text-text-primary sm:grid-cols-7">
            <div>{document.filename}</div>
            <div>{document.doc_type}</div>
            <div>{document.num_pages}</div>
            <div>{document.extraction_method}</div>
            <div>{document.num_chunks ?? 0}</div>
            <div>{new Date(document.processed_at).toLocaleString()}</div>
            <div>
              <button
                type="button"
                onClick={onReingest ? () => void onReingest(document.doc_id) : undefined}
                className="rounded-md border border-slate-700 bg-bg-elevated px-3 py-2 text-xs text-text-primary hover:border-white"
              >
                Re-ingest
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
