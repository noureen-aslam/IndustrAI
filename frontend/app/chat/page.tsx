"use client";

import { useEffect, useState } from "react";
import { ChatInterface } from "@/components/ChatInterface";
import { Document } from "@/lib/types";

export default function ChatPage() {
  const [documents, setDocuments] = useState<Document[]>([]);

  useEffect(() => {
    fetch("/api/documents")
      .then((response) => response.json())
      .then((data) => {
        if (!Array.isArray(data)) {
          setDocuments([]);
          return;
        }
        setDocuments(data);
      })
      .catch(() => setDocuments([]));
  }, []);

  return (
    <main className="mx-auto min-h-screen max-w-7xl px-4 py-6 lg:px-8">
      <div className="grid gap-6 lg:grid-cols-[1fr]">
        <ChatInterface documents={documents} />
      </div>
    </main>
  );
}
