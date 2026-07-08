"use client";

import { useEffect, useState } from "react";
import { ChatInterface } from "@/components/ChatInterface";
import { Document } from "@/lib/types";

export default function ChatPage() {
  const [documents, setDocuments] = useState<Document[]>([]);

  useEffect(() => {
    fetch("/api/documents")
      .then((response) => response.json())
      .then((data) => setDocuments(data ?? []))
      .catch(() => setDocuments([]));
  }, []);

  return (
    <main className="min-h-screen bg-primary px-4 py-6 lg:px-10">
      <div className="mx-auto flex max-w-7xl flex-col gap-6 lg:flex-row">
        <div className="flex-1 lg:min-w-[720px]">
          <ChatInterface documents={documents} />
        </div>
      </div>
    </main>
  );
}
