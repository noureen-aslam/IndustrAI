"use client";

import { type ChangeEvent, useState } from "react";

const DOC_TYPES = [
  { label: "Regulatory Standards", value: "regulatory" },
  { label: "Equipment Manuals", value: "manuals" },
  { label: "Inspection Forms", value: "inspection_forms" },
  { label: "P&ID Drawings", value: "pid_samples" },
];

export function DocumentUpload() {
  const [file, setFile] = useState<File | null>(null);
  const [docType, setDocType] = useState<string>(DOC_TYPES[0].value);
  const [status, setStatus] = useState<string | null>(null);
  const [progress, setProgress] = useState<number>(0);
  const [error, setError] = useState<string | null>(null);

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const selected = event.target.files?.[0] ?? null;
    if (selected && selected.type !== "application/pdf") {
      setError("Only PDF files are allowed.");
      setFile(null);
      return;
    }
    if (selected && selected.size > 50 * 1024 * 1024) {
      setError("File size must be 50MB or smaller.");
      setFile(null);
      return;
    }
    setError(null);
    setFile(selected);
  };

  const handleSubmit = async () => {
    if (!file) {
      setError("Please select a PDF file to upload.");
      return;
    }

    setStatus(null);
    setError(null);
    setProgress(0);

    const formData = new FormData();
    formData.append("file", file);
    formData.append("doc_type", docType);

    try {
      const response = await fetch("/api/ingest", {
        method: "POST",
        body: formData,
      });
      const result = await response.json();
      if (!response.ok) {
        throw new Error(result.error ?? "Upload failed.");
      }
      setStatus(result.message);
      setProgress(100);
      setFile(null);
    } catch (uploadError) {
      setError((uploadError as Error).message);
    }
  };

  return (
    <div className="rounded-xl border border-slate-700 bg-surface p-6">
      <h2 className="text-lg font-semibold text-text-primary">Upload document</h2>
      <p className="mt-2 text-sm text-text-secondary">Add PDF files for ingestion and knowledge extraction.</p>

      <div className="mt-5 space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-2 text-sm text-text-secondary">
            Document type
            <select
              value={docType}
              onChange={(event) => setDocType(event.target.value)}
              className="rounded-lg border border-slate-700 bg-bg-elevated px-3 py-2 text-text-primary"
            >
              {DOC_TYPES.map((option) => (
                <option value={option.value} key={option.value}>{option.label}</option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-2 text-sm text-text-secondary">
            PDF file
            <input type="file" accept="application/pdf" onChange={handleFileChange} className="text-text-primary" />
          </label>
        </div>

        {file ? <p className="text-sm text-text-primary">Selected: {file.name}</p> : null}

        <button
          type="button"
          onClick={handleSubmit}
          className="inline-flex items-center justify-center rounded-lg bg-accent-orange px-4 py-2 text-sm font-semibold text-black hover:bg-orange-400"
        >
          Upload document
        </button>

        {progress > 0 ? (
          <div className="mt-3 rounded-full bg-slate-800 p-1">
            <div className="h-2 rounded-full bg-emerald-500 transition-all" style={{ width: `${progress}%` }} />
          </div>
        ) : null}

        {status ? <p className="text-sm text-emerald-400">{status}</p> : null}
        {error ? <p className="text-sm text-red-400">{error}</p> : null}
      </div>
    </div>
  );
}
