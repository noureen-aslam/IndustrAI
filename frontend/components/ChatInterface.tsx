"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Search, Mic, Send, Sparkles } from "lucide-react";
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

const SUGGESTIONS = [
  "What are the safety requirements for the pump system?",
  "Summarize the inspection checklist for valve assemblies.",
  "Which document covers P&ID line labeling rules?",
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
    if (!Array.isArray(documents)) return {};
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

  const handleSuggestionClick = (prompt: string) => {
    setQuestion(prompt);
    void handleSubmit(prompt);
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
    <div className="rounded-[32px] border border-slate-800 bg-surface/95 p-5 shadow-[0_24px_80px_-40px_rgba(15,23,42,0.85)]">
      <div className="mb-6 rounded-[28px] border border-slate-800 bg-bg-elevated/90 p-5 shadow-sm shadow-slate-950/40">
        <div className="grid gap-5 lg:grid-cols-[1.7fr_0.9fr] lg:items-end">
          <div className="space-y-4">
            <p className="text-sm font-semibold uppercase tracking-[0.24em] text-accent-blue/90">Enterprise knowledge hub</p>
            <div>
              <h1 className="text-3xl font-semibold tracking-tight text-text-primary sm:text-4xl">
                Ask your industrial corpus with confidence
              </h1>
              <p className="mt-3 max-w-2xl text-sm leading-7 text-text-secondary">
                Search across manuals, regulations, inspections, and P&ID drawings with secure source citations and context-aware answers.
              </p>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-[24px] border border-slate-700 bg-slate-950/80 px-4 py-4 shadow-sm shadow-slate-950/20">
              <p className="text-xs uppercase tracking-[0.24em] text-text-secondary">Documents indexed</p>
              <p className="mt-2 text-2xl font-semibold text-text-primary">{documents.length}</p>
            </div>
            <div className="rounded-[24px] border border-slate-700 bg-slate-950/80 px-4 py-4 shadow-sm shadow-slate-950/20">
              <p className="text-xs uppercase tracking-[0.24em] text-text-secondary">Search scope</p>
              <p className="mt-2 text-sm text-text-primary">
                {filter ? FILTER_OPTIONS.find((option) => option.value === filter)?.label : "All documents"}
              </p>
            </div>
          </div>
        </div>

        <div className="mt-6 grid gap-4 lg:grid-cols-[1fr_auto] lg:items-end">
          <div className="rounded-[28px] border border-slate-700 bg-slate-950/90 p-4 shadow-inner">
            <div className="flex items-center gap-3">
              <div className="inline-flex h-11 w-11 items-center justify-center rounded-2xl bg-slate-800 text-text-secondary">
                <Search className="h-5 w-5" />
              </div>
              <div className="min-w-0 flex-1">
                <label htmlFor="query-input" className="sr-only">
                  Search your documents
                </label>
                <input
                  id="query-input"
                  value={question}
                  onChange={(event) => setQuestion(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && !event.shiftKey) {
                      event.preventDefault();
                      void handleSubmit();
                    }
                  }}
                  placeholder="Search your stored documents..."
                  className="w-full border-0 bg-transparent text-sm text-text-primary placeholder:text-text-secondary focus:outline-none"
                />
              </div>
              <button
                type="button"
                onClick={handleVoiceClick}
                aria-label="Start voice search"
                className={`inline-flex h-11 w-11 items-center justify-center rounded-full border transition ${
                  listening
                    ? "border-accent-blue bg-accent-blue/10 text-accent-blue"
                    : "border-slate-700 text-text-secondary hover:border-slate-500 hover:text-text-primary"
                }`}
              >
                <Mic className="h-5 w-5" />
              </button>
            </div>
          </div>

          <button
            type="button"
            onClick={() => void handleSubmit()}
            disabled={loading || !question.trim()}
            className="inline-flex h-14 w-14 items-center justify-center rounded-full bg-accent-blue text-slate-950 shadow-lg shadow-accent-blue/20 transition hover:-translate-y-0.5 hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-60"
            aria-label="Submit question"
          >
            {loading ? <span className="inline-flex h-5 w-5 animate-spin rounded-full border-2 border-white/25 border-t-white" /> : <Send className="h-5 w-5" />}
          </button>
        </div>

        <div className="mt-6 grid gap-3 sm:grid-cols-2">
          <div className="rounded-[24px] border border-slate-700 bg-slate-950/80 p-4 shadow-sm shadow-slate-950/20">
            <p className="text-sm font-semibold text-text-primary">Suggested prompts</p>
            <div className="mt-3 flex flex-wrap gap-3">
              {SUGGESTIONS.map((prompt) => (
                <button
                  key={prompt}
                  type="button"
                  onClick={() => handleSuggestionClick(prompt)}
                  className="rounded-2xl border border-slate-700 bg-slate-900/90 px-4 py-2 text-sm text-text-secondary transition hover:border-slate-500 hover:bg-slate-800 hover:text-text-primary"
                >
                  {prompt}
                </button>
              ))}
            </div>
          </div>

          <div className="rounded-[24px] border border-slate-700 bg-slate-950/80 p-4 shadow-sm shadow-slate-950/20">
            <p className="text-sm font-semibold text-text-primary">Document sources</p>
            <p className="mt-3 text-sm leading-6 text-text-secondary">
              Documents are indexed with full metadata and chunked context, so answers are traceable and easy to verify.
            </p>
          </div>
        </div>
      </div>

      <div className="space-y-5">
        {messages.length === 0 ? (
          <div className="rounded-[28px] border border-slate-800 bg-bg-elevated/80 p-6 text-center shadow-sm shadow-slate-950/20">
            <p className="text-sm uppercase tracking-[0.24em] text-text-secondary">Welcome to IndustrAI</p>
            <h2 className="mt-4 text-2xl font-semibold text-text-primary">Your industrial knowledge assistant</h2>
            <p className="mx-auto mt-3 max-w-2xl text-sm leading-7 text-text-secondary">
              Start by asking a question about safety, maintenance, compliance, or any document in your repository.
            </p>
            <div className="mt-6 grid gap-3 sm:grid-cols-3">
              {SUGGESTIONS.map((prompt) => (
                <button
                  key={prompt}
                  type="button"
                  onClick={() => handleSuggestionClick(prompt)}
                  className="rounded-2xl border border-slate-700 bg-slate-950/90 px-4 py-3 text-sm font-medium text-text-primary transition hover:border-slate-500 hover:bg-slate-900"
                >
                  {prompt}
                </button>
              ))}
            </div>
          </div>
        ) : null}

        <div className="flex flex-col gap-4">
          {messages.map((message) => {
            const isUser = message.role === "user";
            return (
              <div key={message.id} className={`group flex ${isUser ? "justify-end" : "justify-start"}`}>
                <div
                  className={`max-w-[92%] rounded-[30px] border p-5 shadow-sm transition ${
                    isUser ? "border-slate-700 bg-slate-950/90 text-text-primary" : "border-slate-700 bg-bg-elevated text-text-primary"
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <div
                      className={`flex h-9 w-9 items-center justify-center rounded-2xl ${
                        isUser ? "bg-blue-500/15 text-accent-blue" : "bg-slate-700 text-text-secondary"
                      }`}
                    >
                      {isUser ? "U" : "A"}
                    </div>
                    <span className="text-sm font-semibold">{isUser ? "You" : "IndustrAI"}</span>
                  </div>
                  <p className={`mt-4 text-sm leading-7 ${isUser ? "text-text-primary" : "text-text-secondary"}`}>{message.text}</p>

                  {!isUser && message.sources && message.sources.length > 0 ? (
                    <div className="mt-5 rounded-[28px] border border-slate-700 bg-slate-950/80 p-4">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <p className="text-xs uppercase tracking-[0.24em] text-text-secondary">Source citations</p>
                          <p className="mt-1 text-sm font-semibold text-text-primary">Reference documents</p>
                        </div>
                        <Sparkles className="h-5 w-5 text-accent-blue" />
                      </div>
                      <div className="mt-4 grid gap-3 md:grid-cols-2">
                        {message.sources.map((source, index) => {
                          const document = documentMap[source.doc_id];
                          return (
                            <SourceCard
                              key={`${source.doc_id}-${source.page}-${index}`}
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
              </div>
            );
          })}
        </div>
      </div>
      <div ref={bottomRef} />
      {warning ? <p className="mt-4 text-sm text-red-400">{warning}</p> : null}
    </div>
  );
}