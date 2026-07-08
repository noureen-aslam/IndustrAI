import json
import os
from pathlib import Path
from typing import Dict, Iterable, List

from sentence_transformers import SentenceTransformer
from supabase import Client, create_client

ROOT_DIR = Path(__file__).resolve().parent
DATA_PROCESSED_DIR = ROOT_DIR / "data" / "processed"
CHUNKS_DIR = DATA_PROCESSED_DIR / "chunks"
DOCUMENT_INDEX_PATH = DATA_PROCESSED_DIR / "document_index.json"
MODEL_NAME = "all-MiniLM-L6-v2"
BATCH_SIZE = 64


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


def generate_embeddings(model: SentenceTransformer, texts: List[str]) -> List[List[float]]:
    return model.encode(texts, batch_size=BATCH_SIZE, show_progress_bar=False).tolist()


def upsert_document(supabase: Client, doc_meta: Dict[str, any]) -> None:
    response = (
        supabase.table("documents")
        .upsert(doc_meta, on_conflict="doc_id")
        .execute()
    )
    if response.error:
        raise RuntimeError(f"Failed to upsert document {doc_meta.get('doc_id')}: {response.error.message}")


def upsert_chunks(supabase: Client, chunk_rows: List[Dict[str, any]]) -> None:
    if not chunk_rows:
        return
    response = (
        supabase.table("chunks")
        .upsert(chunk_rows, on_conflict="chunk_id")
        .execute()
    )
    if response.error:
        raise RuntimeError(f"Failed to upsert chunk batch: {response.error.message}")


def embed_and_upload_all() -> None:
    supabase = create_supabase_client()
    document_index = read_document_index()
    chunks = read_all_chunk_files()
    if not chunks:
        print("No processed chunks found for embedding.")
        return

    model = SentenceTransformer(MODEL_NAME)
    doc_metadata = {doc_id: metadata for doc_id, metadata in document_index.items()}

    for doc_id, metadata in doc_metadata.items():
        upsert_document(supabase, metadata)

    chunk_texts = [chunk["text"] for chunk in chunks]
    embeddings = generate_embeddings(model, chunk_texts)

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
    upsert_chunks(supabase, rows)
    print(f"Uploaded {len(rows)} chunk embeddings.")


def embed_single_doc(doc_id: str) -> None:
    supabase = create_supabase_client()
    document_index = read_document_index()
    if doc_id not in document_index:
        raise ValueError(f"Document ID not found in index: {doc_id}")

    doc_meta = document_index[doc_id]
    upsert_document(supabase, doc_meta)
    model = SentenceTransformer(MODEL_NAME)

    filtered_chunks = [chunk for chunk in read_all_chunk_files() if chunk.get("doc_id") == doc_id]
    if not filtered_chunks:
        print(f"No chunks found for document {doc_id}.")
        return

    texts = [chunk["text"] for chunk in filtered_chunks]
    embeddings = generate_embeddings(model, texts)
    rows = []
    for chunk, embedding in zip(filtered_chunks, embeddings):
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
    upsert_chunks(supabase, rows)
    print(f"Embedded {len(rows)} chunks for document {doc_id}.")


if __name__ == "__main__":
    embed_and_upload_all()
