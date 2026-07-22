import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";

const COHERE_API_KEY = process.env.COHERE_API_KEY;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
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

interface GeminiCandidate {
  content?: {
    parts?: Array<{ text?: string }>;
  };
}

interface GeminiGenerateResponse {
  candidates?: GeminiCandidate[];
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function createEmbedding(text: string): Promise<number[]> {
  const maxRetries = 3;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
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

    if (response.ok) {
      if (!body.embeddings || body.embeddings.length === 0) {
        throw new Error("Invalid embedding response.");
      }
      return body.embeddings[0];
    }

    const message = JSON.stringify(body);
    const isRateLimit =
      response.status === 429 || message.toLowerCase().includes("rate limit");

    if (isRateLimit && attempt < maxRetries) {
      const waitMs = 3000 * attempt;
      console.warn(`Cohere rate limited, retrying in ${waitMs}ms (attempt ${attempt}/${maxRetries})`);
      await sleep(waitMs);
      continue;
    }

    throw new Error(`Failed to create embedding: ${message}`);
  }

  throw new Error("Failed to create embedding after retries.");
}

function buildContext(chunks: MatchChunkRow[]): string {
  return chunks
    .map(
      (chunk) =>
        `[Source: ${chunk.doc_id}, page ${chunk.page}]\n${chunk.text}`
    )
    .join("\n\n");
}

async function callGemini(
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

  const maxRetries = 4;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          contents: [
            {
              role: "user",
              parts: [{ text: prompt }],
            },
          ],
          generationConfig: {
            temperature: 0,
            maxOutputTokens: 500,
          },
        }),
      }
    );

    if (response.ok) {
      const body = (await response.json()) as GeminiGenerateResponse;
      const text = body.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
      return text ?? "";
    }

    const errText = await response.text();
    const isRetryable =
      response.status === 503 ||
      response.status === 429 ||
      errText.toLowerCase().includes("unavailable") ||
      errText.toLowerCase().includes("high demand") ||
      errText.toLowerCase().includes("rate limit");

    if (isRetryable && attempt < maxRetries) {
      const waitMs = 2000 * attempt;
      console.warn(`Gemini transient error (attempt ${attempt}/${maxRetries}), retrying in ${waitMs}ms`);
      await new Promise((resolve) => setTimeout(resolve, waitMs));
      continue;
    }

    throw new Error(`Gemini API request failed: ${errText}`);
  }

  throw new Error("Gemini API request failed after retries.");
}

export async function POST(request: Request) {
  try {
    if (!COHERE_API_KEY || !GEMINI_API_KEY || !SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
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

    let answer: string;
    try {
      answer = await callGemini(context, question);
    } catch (geminiError) {
      console.error("Gemini generation failed, returning sources without a synthesized answer:", geminiError);
      answer =
        "The answer generation model is temporarily unavailable, but here are the most relevant source documents retrieved for this question:";
    }

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