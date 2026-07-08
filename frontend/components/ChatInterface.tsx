"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Document, QueryResult } from "@/lib/types";
import { SourceCard } from "@/components/SourceCard";
import { ConfidenceBar } from "@/components/ConfidenceBar";

interface Message {
  id: string;
  role: "user" | "assistant";
  text: string;
  sources?: Array<{ doc_id: string; page: number; similarity: number }>;
  confidence?: number;
}

interface ChatInterfaceProps {
  documents: Document[];
}

const FILTER_OPTIONS = [
  { label: "All Documents", value: "" },
  { label: "Regulatory Standards", value: "regulatory" },
  { label: "Equipment Manuals", value: "manuals" },
  { label: "Inspection Forms", value: "inspection_forms" },
  { label: "P&ID Drawings", value: "pid_samples" },
];

interface SpeechRecognitionResultItem {
  transcript: string;
}

interface SpeechRecognitionResult {
  readonly isFinal: boolean;
  readonly length: number;
  item(index: number): SpeechRecognitionResultItem;
}

interface SpeechRecognitionEvent extends Event {
  readonly results: SpeechRecognitionResult[];
}

interface SpeechRecognitionInstance {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: SpeechRecognitionEvent) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
}

interface SpeechRecognitionConstructor {
  new (): SpeechRecognitionInstance;
}

export function ChatInterface({ documents }: ChatInterfaceProps) {
  const [question, setQuestion] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [filter, setFilter] = useState("");
  const [loading, setLoading] = useState(false);
  const [listening, setListening] = useState(false);
  const [warning, setWarning] = useState<string | null>(null);
  const recognition = useRef<SpeechRecognitionInstance | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  const documentMap = useMemo(() => {
    return documents.reduce<Record<string, Document>>((acc, doc) => {
      acc[doc.doc_id] = doc;
      return acc;
    }, {});
  }, [documents]);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const recognitionConstructor = (window as unknown as {
      webkitSpeechRecognition?: SpeechRecognitionConstructor;
      SpeechRecognition?: SpeechRecognitionConstructor;
    }).webkitSpeechRecognition ||
      (window as unknown as { SpeechRecognition?: SpeechRecognitionConstructor }).SpeechRecognition;

    if (!recognitionConstructor) return;

    recognition.current = new recognitionConstructor();
    recognition.current.continuous = false;
    recognition.current.interimResults = false;
    recognition.current.lang = "en-US";
    recognition.current.onresult = (event: SpeechRecognitionEvent) => {
      const transcript = event.results[0].item(0).transcript;
      setQuestion(transcript);
      void handleSubmit(transcript);
      setListening(false);
    };
    recognition.current.onend = () => setListening(false);
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleVoiceClick = () => {
    if (!recognition.current) {
      setWarning("Voice recognition is not supported in this browser.");
      return;
    }
    if (listening) {
      recognition.current.stop();
      setListening(false);
      return;
    }
    recognition.current.start();
    setListening(true);
    setWarning(null);
  };

  const handleSubmit = async (text?: string) => {
    const trimmed = (text ?? question).trim();
    if (!trimmed) {
      setWarning("Please enter a question.");
      return;
    }
    setWarning(null);
    setLoading(true);
    const userMessage: Message = { id: `user-${Date.now()}`, role: "user", text: trimmed };
    setMessages((current) => [...current, userMessage]);
    setQuestion("");

    try {
      const response = await fetch("/api/query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: trimmed, doc_type_filter: filter || undefined }),
      });
      const payload = (await response.json()) as QueryResult & { error?: string };
      if (!response.ok) {
        throw new Error(payload.error || "Failed to fetch answer.");
      }
      const sourceList = payload.sources ?? [];
      const assistantMessage: Message = {
        id: `assistant-${Date.now()}`,
        role: "assistant",
        text: payload.answer,
        sources: sourceList,
        confidence: payload.confidence,
      };
      setMessages((current) => [...current, assistantMessage]);
    } catch (error: unknown) {
      setMessages((current) => [
        ...current,
        { id: `assistant-${Date.now()}`, role: "assistant", text: `Error: ${(error as Error).message}` },
      ]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="rounded-3xl border border-slate-800 bg-surface p-5 shadow-lg shadow-slate-950/30">
      <div className="mb-5 flex flex-col gap-4 rounded-xl border border-slate-700 bg-bg-elevated p-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold text-text-primary">Ask your industrial corpus</h1>
          <p className="mt-1 text-sm text-text-secondary">
            Ask questions about manuals, regulations, inspections, and P&ID drawings.
          </p>
        </div>

        <select
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          className="w-full rounded-lg border border-slate-700 bg-bg-surface px-3 py-2 text-text-primary sm:w-auto"
        >
          {FILTER_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>

      <div className="space-y-4">
        {messages.map((message) => (
          <div key={message.id} className={`rounded-3xl border px-5 py-4 ${message.role === "user" ? "border-slate-700 bg-slate-900 self-end" : "border-slate-700 bg-bg-elevated"}`}>
            <p className={`text-sm ${message.role === "user" ? "text-orange-300" : "text-text-primary"}`}>{message.text}</p>
            {message.role === "assistant" && message.confidence !== undefined ? (
              <div className="mt-3">
                {message.confidence < 0.25 || message.text.includes("I don't have enough information") ? (
                  <div className="rounded-lg bg-red-900/80 px-4 py-3 text-sm text-red-200">
                    I don't have enough information in the available documents.
                  </div>
                ) : null}
                <ConfidenceBar confidence={message.confidence} />
                {message.sources && message.sources.length > 0 ? (
                  <div className="mt-4 rounded-xl border border-slate-700 bg-primary p-4">
                    <h3 className="text-sm font-semibold text-text-primary">Sources</h3>
                    <div className="mt-3 grid gap-3 sm:grid-cols-2">
                      {message.sources.map((source) => {
                        const document = documentMap[source.doc_id];
                        return (
                          <SourceCard
                            key={`${source.doc_id}-${source.page}`}
                            docId={source.doc_id}
                            page={source.page}
                            similarity={source.similarity}
                            docType={document?.doc_type ?? "default"}
                            filename={document?.filename ?? source.doc_id}
                          />
                        );
                      })}
                    </div>
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        ))}
      </div>

      <div ref={bottomRef} />

      <div className="fixed inset-x-0 bottom-0 border-t border-slate-800 bg-bg-surface p-4 sm:static sm:border-none sm:bg-transparent">
        <div className="flex items-center gap-3">
          <textarea
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                handleSubmit();
              }
            }}
            rows={2}
            placeholder="Ask a question about your documents..."
            className="w-full resize-none rounded-2xl border border-slate-700 bg-bg-elevated px-4 py-3 text-sm text-text-primary placeholder:text-text-secondary focus:border-accent-blue focus:outline-none"
          />
          <button
            type="button"
            onClick={() => handleVoiceClick()}
            className={`rounded-full border px-4 py-3 text-sm ${listening ? "border-accent-blue text-accent-blue" : "border-slate-700 text-text-primary"}`}
          >
            {listening ? "Listening" : "Voice"}
          </button>
          <button
            type="button"
            onClick={() => handleSubmit()}
            disabled={loading}
            className="rounded-2xl bg-accent-blue px-5 py-3 text-sm font-semibold text-black disabled:opacity-50"
          >
            {loading ? "Searching documents..." : "Send"}
          </button>
        </div>
        {warning ? <p className="mt-2 text-sm text-red-400">{warning}</p> : null}
      </div>
    </div>
  );
}
