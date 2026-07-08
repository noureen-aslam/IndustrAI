import json
import os
import sys
from typing import Any, Dict, List, Optional

from anthropic import Anthropic
from sentence_transformers import SentenceTransformer
from supabase import Client, create_client

MODEL_NAME = "all-MiniLM-L6-v2"
MIN_SIMILARITY = 0.25
TOP_K = 5

SYSTEM_INSTRUCTIONS = (
    "You are a private industrial document assistant. Answer only from the provided context, never hallucinate, "
    "cite sources in brackets as [Source: doc_id, page X], and return 'I don't have enough information' if the context is insufficient."
)


def get_env_variable(name: str) -> str:
    value = os.environ.get(name)
    if not value:
        raise EnvironmentError(f"Missing required environment variable: {name}")
    return value


def create_supabase_client() -> Client:
    url = get_env_variable("SUPABASE_URL")
    key = get_env_variable("SUPABASE_KEY")
    return create_client(url, key)


def create_anthropic_client() -> Anthropic:
    key = get_env_variable("ANTHROPIC_API_KEY")
    return Anthropic(api_key=key)


def embed_text(text: str, model: SentenceTransformer) -> List[float]:
    return model.encode([text], show_progress_bar=False)[0].tolist()


def build_context(chunks: List[Dict[str, Any]]) -> str:
    context_parts = []
    for chunk in chunks:
        source = f"[Source: {chunk['doc_id']}, page {chunk['page']}]"
        context_parts.append(f"{source}\n{chunk['text']}\n")
    return "\n".join(context_parts)


def query_chunks(supabase: Client, embedding: List[float], doc_type_filter: Optional[str]) -> List[Dict[str, Any]]:
    rpc_args = {"query_embedding": embedding, "match_count": TOP_K}
    if doc_type_filter:
        rpc_args["filter_doc_type"] = doc_type_filter
    response = supabase.rpc("match_chunks", rpc_args).execute()
    if response.error:
        raise RuntimeError(f"Supabase RPC failed: {response.error.message}")
    return [row for row in (response.data or []) if row.get("similarity", 0) >= MIN_SIMILARITY]


def call_claude(anthropic: Anthropic, context: str, question: str) -> str:
    prompt = f"{SYSTEM_INSTRUCTIONS}\n\nCONTEXT:\n{context}\n\nQUESTION: {question}\n\nAnswer:" 
    response = anthropic.completions.create(
        model="claude-sonnet-4-6",
        prompt=prompt,
        max_tokens_to_sample=500,
        temperature=0.0,
        stop_sequences=["\n\n"],
    )
    return response.get("completion", "").strip()


def log_query(supabase: Client, question: str, answer: str, chunks: List[Dict[str, Any]], confidence: float) -> None:
    cited_chunk_ids = [chunk["chunk_id"] for chunk in chunks]
    payload = {
        "user_id": "web_user",
        "question": question,
        "answer": answer,
        "cited_chunk_ids": cited_chunk_ids,
        "confidence_score": confidence,
    }
    response = supabase.table("query_log").insert(payload).execute()
    if response.error:
        raise RuntimeError(f"Failed to log query: {response.error.message}")


def parse_similarity(answer: str, chunks: List[Dict[str, Any]]) -> float:
    if not chunks:
        return 0.0
    return sum(chunk.get("similarity", 0.0) for chunk in chunks) / len(chunks)


def main() -> None:
    if len(sys.argv) < 2:
        print("Usage: python query.py '<question>' [doc_type_filter]")
        return

    question = sys.argv[1]
    doc_type_filter = sys.argv[2] if len(sys.argv) > 2 else None
    supabase = create_supabase_client()
    model = SentenceTransformer(MODEL_NAME)
    anthropic = create_anthropic_client()

    query_embedding = embed_text(question, model)
    matched_chunks = query_chunks(supabase, query_embedding, doc_type_filter)
    context = build_context(matched_chunks)
    answer = call_claude(anthropic, context, question)
    confidence = parse_similarity(answer, matched_chunks)
    log_query(supabase, question, answer, matched_chunks, confidence)

    output = {
        "answer": answer,
        "sources": [
            {
                "doc_id": chunk["doc_id"],
                "page": chunk["page"],
                "similarity": chunk["similarity"],
            }
            for chunk in matched_chunks
        ],
        "confidence": confidence,
    }
    print(json.dumps(output, indent=2))


if __name__ == "__main__":
    main()
