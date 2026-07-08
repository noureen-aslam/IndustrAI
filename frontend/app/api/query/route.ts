import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";

const COHERE_API_KEY = process.env.COHERE_API_KEY;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;

if (!COHERE_API_KEY || !ANTHROPIC_API_KEY || !SUPABASE_URL) {
  throw new Error("Missing required environment variables for query route.");
}

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
      texts: [text],
    }),
  });
  if (!response.ok) {
    throw new Error("Failed to create embedding.");
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
  const prompt = `You are a private industrial document assistant. Answer only from the provided context, never hallucinate, cite sources in brackets as [Source: doc_id, page X], and return \"I don't have enough information\" if the context is insufficient.\n\nCONTEXT:\n${context}\n\nQUESTION: ${question}\n\nAnswer:`;

  const response = await fetch("https://api.anthropic.com/v1/complete", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${ANTHROPIC_API_KEY}`,
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      prompt,
      max_tokens_to_sample: 500,
      temperature: 0,
      stop_sequences: ["\n\n"],
    }),
  });
  if (!response.ok) {
    throw new Error("Claude API request failed.");
  }
  const body = await response.json();
  return body.completion?.trim() ?? "";
}

export async function POST(request: Request) {
  try {
    const payload = (await request.json()) as RequestBody;
    const question = payload.question?.trim();
    if (!question) {
      return NextResponse.json({ error: "Question is required." }, { status: 400 });
    }

    const embedding = await createEmbedding(question);
    const rpcResult = await supabaseAdmin.rpc<MatchChunkRow>("match_chunks", {
      query_embedding: embedding,
      match_count: 5,
      filter_doc_type: payload.doc_type_filter ?? null,
    });
    if (rpcResult.error) {
      throw new Error(rpcResult.error.message);
    }
    const chunks = (rpcResult.data ?? []).filter(
      (chunk): chunk is MatchChunkRow => typeof chunk.similarity === "number" && chunk.similarity >= 0.25
    );

    const context = buildContext(chunks);
    const answer = await callClaude(context, question);
    const confidence = chunks.length
      ? chunks.reduce((sum, chunk) => sum + chunk.similarity, 0) / chunks.length
      : 0;

    await supabaseAdmin.table("query_log").insert({
      user_id: "web_user",
      question,
      answer,
      cited_chunk_ids: chunks.map((chunk) => chunk.chunk_id),
      confidence_score: confidence,
    });

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
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
