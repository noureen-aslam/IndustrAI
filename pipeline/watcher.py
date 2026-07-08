import os
import time
from datetime import datetime
from pathlib import Path
from typing import Dict, Iterable, List, Tuple

from ingest import process_file, read_document_index, scan_raw_documents
from embed_and_upload import embed_single_doc
from extract_entities import extract_entities_single_doc
from supabase import Client, create_client

ROOT_DIR = Path(__file__).resolve().parent
DATA_DIR = ROOT_DIR / "data"
DOCUMENT_INDEX_PATH = DATA_DIR / "processed" / "document_index.json"


def get_env_variable(name: str, default: str = None) -> str:
    if default is not None:
        return os.environ.get(name, default)
    value = os.environ.get(name)
    if not value:
        raise EnvironmentError(f"Missing required environment variable: {name}")
    return value


def create_supabase_client() -> Client:
    url = get_env_variable("SUPABASE_URL")
    key = get_env_variable("SUPABASE_KEY")
    return create_client(url, key)


def load_document_index() -> Dict[str, Dict[str, any]]:
    if not DOCUMENT_INDEX_PATH.exists():
        return {}
    try:
        with open(DOCUMENT_INDEX_PATH, "r", encoding="utf-8") as handle:
            return __import__("json").load(handle)
    except (OSError, ValueError):
        return {}


def iso_now() -> str:
    return datetime.utcnow().isoformat() + "Z"


def log(message: str) -> None:
    print(f"[{iso_now()}] {message}")


def get_existing_doc_id(document_index: Dict[str, Dict[str, any]], file_path: Path) -> str:
    for doc_id, metadata in document_index.items():
        if metadata.get("storage_path") == str(file_path):
            return doc_id
    return ""


def delete_existing_document_data(supabase: Client, doc_id: str) -> None:
    chunk_query = supabase.table("chunks").select("chunk_id").eq("doc_id", doc_id).execute()
    if chunk_query.error:
        raise RuntimeError(f"Failed to query chunk ids: {chunk_query.error.message}")
    chunk_ids = [item["chunk_id"] for item in (chunk_query.data or [])]

    if chunk_ids:
        rel_delete = supabase.table("relationships").delete().in_("source_chunk_id", chunk_ids).execute()
        if rel_delete.error:
            raise RuntimeError(f"Failed to delete relationships: {rel_delete.error.message}")

    chunk_delete = supabase.table("chunks").delete().eq("doc_id", doc_id).execute()
    if chunk_delete.error:
        raise RuntimeError(f"Failed to delete chunks: {chunk_delete.error.message}")

    entity_delete = supabase.table("entities").delete().eq("source_doc_id", doc_id).execute()
    if entity_delete.error:
        raise RuntimeError(f"Failed to delete entities: {entity_delete.error.message}")


def process_new_file(supabase: Client, file_path: Path, doc_type: str) -> None:
    log(f"New file detected: {file_path.name} — starting ingestion...")
    result = process_file(file_path, doc_type)
    embed_single_doc(result["doc_id"])
    extract_entities_single_doc(result["doc_id"])
    log(
        f"{file_path.name} — ingestion complete. {result['chunk_count']} chunks, document id {result['doc_id']}."
    )


def process_modified_file(supabase: Client, file_path: Path, doc_type: str, doc_id: str) -> None:
    log(f"Modified file detected: {file_path.name} — cleaning old data and re-ingesting...")
    delete_existing_document_data(supabase, doc_id)
    result = process_file(file_path, doc_type)
    embed_single_doc(result["doc_id"])
    extract_entities_single_doc(result["doc_id"])
    log(f"{file_path.name} — re-ingestion complete.")


def build_file_index(raw_files: Iterable[Tuple[Path, str]]) -> Dict[str, float]:
    return {str(path): path.stat().st_mtime for path, _ in raw_files}


def main() -> None:
    watch_interval = int(get_env_variable("WATCH_INTERVAL_SECONDS", "300"))
    supabase = create_supabase_client()

    while True:
        try:
            document_index = load_document_index()
            raw_files = scan_raw_documents()
            raw_file_map = build_file_index(raw_files)

            for file_path, doc_type in raw_files:
                existing_doc_id = get_existing_doc_id(document_index, file_path)
                if not existing_doc_id:
                    process_new_file(supabase, file_path, doc_type)
                    document_index = load_document_index()
                    continue

                metadata = document_index.get(existing_doc_id, {})
                processed_mtime = metadata.get("modified_at")
                current_mtime = datetime.utcfromtimestamp(file_path.stat().st_mtime).isoformat() + "Z"
                if current_mtime != processed_mtime:
                    process_modified_file(supabase, file_path, doc_type, existing_doc_id)
                    document_index = load_document_index()

            time.sleep(watch_interval)
        except KeyboardInterrupt:
            log("Watcher stopped.")
            break
        except Exception as exc:
            log(f"Watcher error: {exc}")
            time.sleep(watch_interval)


if __name__ == "__main__":
    main()
