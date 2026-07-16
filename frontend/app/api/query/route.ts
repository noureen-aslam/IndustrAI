import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";

const COHERE_API_KEY = process.env.COHERE_API_KEY;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;

interface RequestBody {
  question: string;
  doc_type_filter?: string;
}

interface CohereEmbeddingResponse {
  data: Array<{ embedding: number[] }>;
}

interface MatchChunkRow {
  chunk_id: string;
  doc_id: string;
  page: number;
  text: string;
  similarity: number;
}

interface ClaudeContentBlock {
  type: string;
  text?: string;
}

interface ClaudeMessagesResponse {
  content: ClaudeContentBlock[];
}

// NOTE: The Python pipeline uses sentence-transformers all-MiniLM-L6-v2 (384-dim).
// The frontend query route must use a runtime embedding model that produces compatible 384-dim vectors.
// If you switch embedding providers, re-run embed_and_upload.py with the same vector model for consistency.
async function createEmbedding(text: string): Promise<number[]> {
  const response = await fetch("https://api.cohere.com/v1/embed", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${COHERE_API_KEY}`,
    },
    body: JSON.stringify({
      model: "embed-english-light-v3.0",
      input: [text],
       input_type: "search_query",
    }),
  });
  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Failed to create embedding: ${errText}`);
  }
  const body = (await response.json()) as CohereEmbeddingResponse;
  if (!body.data?.[0]?.embedding) {
    throw new Error("Invalid embedding response.");
  }
  return body.data[0].embedding;
}

function buildContext(chunks: MatchChunkRow[]): string {
  return chunks
    .map((chunk) => `[Source: ${chunk.doc_id}, page ${chunk.page}]\n${chunk.text}`)
    .join("\n\n");
}

async function callClaude(context: string, question: string): Promise<string> {
  const prompt = `You are a private industrial document assistant. Answer only from the provided context, never hallucinate, cite sources in brackets as [Source: doc_id, page X], and return "I don't have enough information" if the context is insufficient.\n\nCONTEXT:\n${context}\n\nQUESTION: ${question}`;

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": ANTHROPIC_API_KEY as string,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-5",
      max_tokens: 500,
      temperature: 0,
      messages: [{ role: "user", content: prompt }],
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Claude API request failed: ${errText}`);
  }

  const body = (await response.json()) as ClaudeMessagesResponse;
  const textBlock = body.content?.find((block) => block.type === "text");
  return (textBlock?.text ?? "").trim();
}

export async function POST(request: Request) {
  try {
    if (!COHERE_API_KEY || !ANTHROPIC_API_KEY || !SUPABASE_URL) {
      return NextResponse.json(
        { error: "Server misconfiguration: missing required environment variables." },
        { status: 500 }
      );
    }

    const payload = (await request.json()) as RequestBody;
    const question = payload.question?.trim();
    if (!question) {
      return NextResponse.json({ error: "Question is required." }, { status: 400 });
    }

    const embedding = await createEmbedding(question);

    const rpcResult = await supabaseAdmin.rpc("match_chunks", {
      query_embedding: embedding,
      match_count: 5,
      filter_doc_type: payload.doc_type_filter ?? null,
    });

    if (rpcResult.error) {
      throw new Error(rpcResult.error.message);
    }

    const rawChunks = (rpcResult.data ?? []) as MatchChunkRow[];
    const chunks = rawChunks.filter(
      (chunk) => typeof chunk.similarity === "number" && chunk.similarity >= 0.25
    );

    // Short-circuit: no relevant chunks means no point paying for a Claude call.
    if (chunks.length === 0) {
      await supabaseAdmin.from("query_log").insert({
        user_id: "web_user",
        question,
        answer: "I don't have enough information.",
        cited_chunk_ids: [],
        confidence_score: 0,
      });

      return NextResponse.json({
        answer: "I don't have enough information.",
        sources: [],
        confidence: 0,
      });
    }

    const context = buildContext(chunks);
    const answer = await callClaude(context, question);
    const confidence =
      chunks.reduce((sum, chunk) => sum + chunk.similarity, 0) / chunks.length;

    const { error: logError } = await supabaseAdmin.from("query_log").insert({
      user_id: "web_user",
      question,
      answer,
      cited_chunk_ids: chunks.map((chunk) => chunk.chunk_id),
      confidence_score: confidence,
    });

    if (logError) {
      // Don't fail the whole request just because logging failed.
      console.error("query_log insert failed:", logError.message);
    }

    return NextResponse.json({
      answer,
      sources: chunks.map((chunk) => ({
        doc_id: chunk.doc_id,
        page: chunk.page,
        similarity: chunk.similarity,
      })),
      confidence,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error occurred.";
    console.error("Query route error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}