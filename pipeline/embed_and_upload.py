import json
import os
import time
from pathlib import Path
from typing import Dict, Iterable, List

import requests
from dotenv import load_dotenv
from supabase import Client, create_client

load_dotenv()

ROOT_DIR = Path(__file__).resolve().parent
DATA_PROCESSED_DIR = ROOT_DIR / "data" / "processed"
CHUNKS_DIR = DATA_PROCESSED_DIR / "chunks"
DOCUMENT_INDEX_PATH = DATA_PROCESSED_DIR / "document_index.json"
COHERE_MODEL = "embed-english-light-v3.0"
COHERE_EMBED_URL = "https://api.cohere.com/v1/embed"
BATCH_SIZE = 90  # Cohere allows up to 96 texts per request
MAX_RETRIES = 6


def get_env_variable(name: str) -> str:
    value = os.environ.get(name)
    if not value:
        raise EnvironmentError(f"Missing required environment variable: {name}")
    return value


def create_supabase_client() -> Client:
    url = get_env_variable("SUPABASE_URL")
    key = get_env_variable("SUPABASE_KEY")
    return create_client(url, key)


def read_document_index() -> Dict[str, any]:
    if not DOCUMENT_INDEX_PATH.exists():
        return {}
    with open(DOCUMENT_INDEX_PATH, "r", encoding="utf-8") as handle:
        return json.load(handle)


def read_all_chunk_files() -> List[Dict[str, any]]:
    chunks = []
    for path in sorted(CHUNKS_DIR.glob("*_chunks.json")):
        with open(path, "r", encoding="utf-8") as handle:
            data = json.load(handle)
            if isinstance(data, list):
                chunks.extend(data)
    return chunks


def chunked_iterable(items: List[any], size: int) -> Iterable[List[any]]:
    for idx in range(0, len(items), size):
        yield items[idx : idx + size]


def cohere_embed_batch(texts: List[str], api_key: str) -> List[List[float]]:
    for attempt in range(1, MAX_RETRIES + 1):
        response = requests.post(
            COHERE_EMBED_URL,
            headers={
                "Content-Type": "application/json",
                "Authorization": f"Bearer {api_key}",
            },
            json={
                "model": COHERE_MODEL,
                "texts": texts,
                "input_type": "search_document",
            },
            timeout=60,
        )
        body = response.json()

        if response.ok:
            embeddings = body.get("embeddings")
            if not embeddings:
                raise RuntimeError(f"Invalid Cohere embed response: {json.dumps(body)}")
            return embeddings

        message = str(body.get("message", ""))
        is_rate_limit = response.status_code == 429 or "rate limit" in message.lower()

        if is_rate_limit and attempt < MAX_RETRIES:
            wait_seconds = min(65, 5 * attempt)
            print(f"  Rate limited (attempt {attempt}/{MAX_RETRIES}). Waiting {wait_seconds}s...")
            time.sleep(wait_seconds)
            continue

        raise RuntimeError(f"Cohere embed request failed: {json.dumps(body)}")

    raise RuntimeError("Cohere embed request failed after max retries.")


def upsert_document(supabase: Client, doc_meta: Dict[str, any]) -> None:
    response = (
        supabase.table("documents")
        .upsert(doc_meta, on_conflict="doc_id")
        .execute()
    )
    if getattr(response, "error", None):
        raise RuntimeError(f"Failed to upsert document {doc_meta.get('doc_id')}: {response.error}")


def upsert_chunks(supabase: Client, chunk_rows: List[Dict[str, any]]) -> None:
    if not chunk_rows:
        return
    response = (
        supabase.table("chunks")
        .upsert(chunk_rows, on_conflict="chunk_id")
        .execute()
    )
    if getattr(response, "error", None):
        raise RuntimeError(f"Failed to upsert chunk batch: {response.error}")


def build_rows(chunks: List[Dict[str, any]], embeddings: List[List[float]]) -> List[Dict[str, any]]:
    rows = []
    for chunk, embedding in zip(chunks, embeddings):
        rows.append(
            {
                "chunk_id": chunk["chunk_id"],
                "doc_id": chunk["doc_id"],
                "page": chunk["page"],
                "text": chunk["text"],
                "word_count": chunk["word_count"],
                "embedding": embedding,
            }
        )
    return rows


def embed_and_upload_all() -> None:
    cohere_api_key = get_env_variable("COHERE_API_KEY")
    supabase = create_supabase_client()
    document_index = read_document_index()
    chunks = read_all_chunk_files()
    if not chunks:
        print("No processed chunks found for embedding.")
        return

    doc_metadata = {doc_id: metadata for doc_id, metadata in document_index.items()}
    for doc_id, metadata in doc_metadata.items():
        upsert_document(supabase, metadata)
    print(f"Upserted {len(doc_metadata)} documents.")

    chunk_batches = list(chunked_iterable(chunks, BATCH_SIZE))
    total_uploaded = 0

    for i, chunk_batch in enumerate(chunk_batches, start=1):
        texts = [c["text"] for c in chunk_batch]
        print(f"Embedding batch {i}/{len(chunk_batches)} ({len(texts)} texts)...")
        embeddings = cohere_embed_batch(texts, cohere_api_key)

        rows = build_rows(chunk_batch, embeddings)
        upsert_chunks(supabase, rows)
        total_uploaded += len(rows)
        print(f"  Uploaded batch {i} ({len(rows)} rows). Running total: {total_uploaded}")

        time.sleep(0.5)  # light rate-limit courtesy between batches

    print(f"Done. Uploaded {total_uploaded} chunk embeddings total.")


def embed_single_doc(doc_id: str) -> None:
    cohere_api_key = get_env_variable("COHERE_API_KEY")
    supabase = create_supabase_client()
    document_index = read_document_index()
    if doc_id not in document_index:
        raise ValueError(f"Document ID not found in index: {doc_id}")

    doc_meta = document_index[doc_id]
    upsert_document(supabase, doc_meta)

    filtered_chunks = [chunk for chunk in read_all_chunk_files() if chunk.get("doc_id") == doc_id]
    if not filtered_chunks:
        print(f"No chunks found for document {doc_id}.")
        return

    chunk_batches = list(chunked_iterable(filtered_chunks, BATCH_SIZE))
    total_uploaded = 0
    for i, chunk_batch in enumerate(chunk_batches, start=1):
        texts = [c["text"] for c in chunk_batch]
        embeddings = cohere_embed_batch(texts, cohere_api_key)
        rows = build_rows(chunk_batch, embeddings)
        upsert_chunks(supabase, rows)
        total_uploaded += len(rows)
        time.sleep(0.5)

    print(f"Embedded {total_uploaded} chunks for document {doc_id}.")


if __name__ == "__main__":
    embed_and_upload_all()