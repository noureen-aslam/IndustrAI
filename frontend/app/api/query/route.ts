import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";

const COHERE_API_KEY = process.env.COHERE_API_KEY;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

interface RequestBody {
  question: string;
  doc_type_filter?: string;
}

interface CohereEmbeddingResponse {
  embeddings: number[][];
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
      input_type: "search_query",
    }),
  });

  const body = (await response.json()) as CohereEmbeddingResponse;

  console.log("Cohere Response:", JSON.stringify(body, null, 2));

  if (!response.ok) {
    throw new Error(`Failed to create embedding: ${JSON.stringify(body)}`);
  }

  if (!body.embeddings || body.embeddings.length === 0) {
    throw new Error("Invalid embedding response.");
  }

  return body.embeddings[0];
}

function buildContext(chunks: MatchChunkRow[]): string {
  return chunks
    .map(
      (chunk) =>
        `[Source: ${chunk.doc_id}, page ${chunk.page}]\n${chunk.text}`
    )
    .join("\n\n");
}

async function callClaude(
  context: string,
  question: string
): Promise<string> {
  const prompt = `You are a private industrial document assistant.

Answer ONLY from the provided context.
Never hallucinate.
Always cite sources like [Source: doc_id, page X].

If the context does not contain the answer, reply:

"I don't have enough information."

CONTEXT:
${context}

QUESTION:
${question}`;

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": ANTHROPIC_API_KEY as string,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 500,
      temperature: 0,
      messages: [
        {
          role: "user",
          content: prompt,
        },
      ],
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Claude API request failed: ${errText}`);
  }

  const body = (await response.json()) as ClaudeMessagesResponse;

  const textBlock = body.content.find((c) => c.type === "text");

  return textBlock?.text?.trim() ?? "";
}

export async function POST(request: Request) {
  try {
    if (!COHERE_API_KEY || !ANTHROPIC_API_KEY || !SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      return NextResponse.json(
        {
          error: "Server misconfiguration: missing environment variables.",
        },
        { status: 500 }
      );
    }

    if (!supabaseAdmin) {
      return NextResponse.json(
        {
          error: "Server misconfiguration: supabaseAdmin client is unavailable.",
        },
        { status: 500 }
      );
    }

    const payload = (await request.json()) as RequestBody;

    const question = payload.question?.trim();

    if (!question) {
      return NextResponse.json(
        { error: "Question is required." },
        { status: 400 }
      );
    }

    const embedding = await createEmbedding(question);

    console.log("Embedding dimension:", embedding.length);

    const { data, error } = await supabaseAdmin.rpc("match_chunks", {
      query_embedding: embedding,
      match_count: 5,
      filter_doc_type: payload.doc_type_filter ?? null,
    });

    if (error) {
      throw new Error(error.message);
    }

    const chunks: MatchChunkRow[] = ((data ?? []) as MatchChunkRow[]).filter(
      (chunk) =>
        typeof chunk.similarity === "number" &&
        chunk.similarity >= 0.25
    );

    if (chunks.length === 0) {
      return NextResponse.json({
        answer: "I don't have enough information.",
        confidence: 0,
        sources: [],
      });
    }

    const context = buildContext(chunks);

    const answer = await callClaude(context, question);

    const confidence =
      chunks.reduce((sum, c) => sum + c.similarity, 0) / chunks.length;

    await supabaseAdmin.from("query_log").insert({
      user_id: "web_user",
      question,
      answer,
      cited_chunk_ids: chunks.map((c) => c.chunk_id),
      confidence_score: confidence,
    });

    return NextResponse.json({
      answer,
      confidence,
      sources: chunks.map((c) => ({
        doc_id: c.doc_id,
        page: c.page,
        similarity: c.similarity,
      })),
    });
  } catch (err) {
    console.error(err);

    return NextResponse.json(
      {
        error: err instanceof Error ? err.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}