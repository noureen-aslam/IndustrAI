"use client";

import { useEffect, useState } from "react";
import { DocumentUpload } from "@/components/DocumentUpload";
import { DocumentTable } from "@/components/DocumentTable";
import { Document } from "@/lib/types";

export default function AdminPage() {
  const [documents, setDocuments] = useState<Document[]>([]);

  const fetchDocuments = async () => {
    try {
      const response = await fetch("/api/documents");
      const data = await response.json();
      setDocuments(data ?? []);
    } catch {
      setDocuments([]);
    }
  };

  useEffect(() => {
    void fetchDocuments();
  }, []);

  const handleReingest = async (docId: string) => {
    await fetch("/api/documents/reingest", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ doc_id: docId }),
    });
    await fetchDocuments();
  };

  return (
    <main className="min-h-screen bg-primary px-4 py-6 lg:px-10">
      <div className="mx-auto grid gap-8 max-w-7xl lg:grid-cols-[1.2fr_1fr]">
        <div>
          <DocumentUpload />
        </div>
        <div>
          <DocumentTable documents={documents} onReingest={handleReingest} />
        </div>
      </div>
    </main>
  );
}
