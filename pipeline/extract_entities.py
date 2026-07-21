import json
import os
import re
import time
from pathlib import Path
from typing import Any, Dict, List

import requests
from dotenv import load_dotenv
from supabase import Client, create_client

load_dotenv()

DATA_DIR = Path(__file__).resolve().parent / "data"
PROCESSED_CHUNKS_PATH = DATA_DIR / "processed" / "processed_chunks.json"
CHUNKS_DIR = DATA_DIR / "processed" / "chunks"

GEMINI_MODEL = "gemini-3.5-flash"
GEMINI_URL = f"https://generativelanguage.googleapis.com/v1beta/models/{GEMINI_MODEL}:generateContent"
MAX_RETRIES = 5

SYSTEM_PROMPT = (
    "You are an industrial knowledge extraction system. Extract entities and relationships from the provided industrial document chunk. "
    "Respond ONLY with valid JSON, no markdown, no explanation, no preamble. Use this exact schema:\n"
    '{\n'
    '  "entities": [{"name": "string", "type": "equipment|regulation_clause|procedure|location|personnel", "canonical_key": "string"}],\n'
    '  "relationships": [{"source": "canonical_key", "target": "canonical_key", "type": "governed_by|inspected_in|maintained_by|references|located_in|requires"}]\n'
    '}\n'
    "canonical_key must be lowercase, underscores only, no special characters. Example: 'pump_cp_450', 'oisd_std_118_clause_4_2'. "
    "Only extract entities explicitly mentioned. If no entities found, return {\"entities\": [], \"relationships\": []}."
)


def load_processed_chunks() -> Dict[str, Any]:
    if not PROCESSED_CHUNKS_PATH.exists():
        return {"processed_chunk_ids": []}
    try:
        with open(PROCESSED_CHUNKS_PATH, "r", encoding="utf-8") as handle:
            return json.load(handle)
    except (json.JSONDecodeError, OSError):
        return {"processed_chunk_ids": []}


def save_processed_chunks(data: Dict[str, Any]) -> None:
    PROCESSED_CHUNKS_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(PROCESSED_CHUNKS_PATH, "w", encoding="utf-8") as handle:
        json.dump(data, handle, indent=2)


def safe_parse_json(raw: str) -> Dict[str, Any]:
    cleaned = raw.strip()
    if cleaned.startswith("```"):
        cleaned = re.sub(r"^```(json)?", "", cleaned).strip()
        cleaned = re.sub(r"```$", "", cleaned).strip()
    try:
        return json.loads(cleaned)
    except json.JSONDecodeError:
        normalized = re.sub(r"(?<!\\)'", '"', cleaned)
        return json.loads(normalized)


def get_env_variable(name: str) -> str:
    value = os.environ.get(name)
    if not value:
        raise EnvironmentError(f"Missing required environment variable: {name}")
    return value


def create_supabase_client() -> Client:
    url = get_env_variable("SUPABASE_URL")
    key = get_env_variable("SUPABASE_KEY")
    return create_client(url, key)


def read_chunk_files() -> List[Dict[str, Any]]:
    chunk_files = sorted(CHUNKS_DIR.glob("*_chunks.json"))
    chunks: List[Dict[str, Any]] = []
    for chunk_file in chunk_files:
        try:
            with open(chunk_file, "r", encoding="utf-8") as handle:
                data = json.load(handle)
                if isinstance(data, list):
                    chunks.extend(data)
        except (json.JSONDecodeError, OSError):
            continue
    return chunks


def read_chunks_for_doc(doc_id: str) -> List[Dict[str, Any]]:
    chunks = []
    for chunk_file in sorted(CHUNKS_DIR.glob("*_chunks.json")):
        try:
            with open(chunk_file, "r", encoding="utf-8") as handle:
                data = json.load(handle)
                if isinstance(data, list):
                    chunks.extend([chunk for chunk in data if chunk.get("doc_id") == doc_id])
        except (json.JSONDecodeError, OSError):
            continue
    return chunks


def extract_entities_from_text(chunk_text: str, api_key: str) -> Dict[str, Any]:
    prompt = f"{SYSTEM_PROMPT}\n\nDOCUMENT CHUNK:\n{chunk_text}"

    for attempt in range(1, MAX_RETRIES + 1):
        response = requests.post(
            f"{GEMINI_URL}?key={api_key}",
            headers={"Content-Type": "application/json"},
            json={
                "contents": [{"role": "user", "parts": [{"text": prompt}]}],
                "generationConfig": {"temperature": 0, "maxOutputTokens": 600},
            },
            timeout=60,
        )
        body = response.json()

        if response.ok:
            text = (
                body.get("candidates", [{}])[0]
                .get("content", {})
                .get("parts", [{}])[0]
                .get("text", "")
            )
            return safe_parse_json(text)

        message = json.dumps(body)
        is_rate_limit = response.status_code == 429 or "rate" in message.lower() or "quota" in message.lower()

        if is_rate_limit and attempt < MAX_RETRIES:
            wait_seconds = min(60, 5 * attempt)
            print(f"    Rate limited (attempt {attempt}/{MAX_RETRIES}). Waiting {wait_seconds}s...")
            time.sleep(wait_seconds)
            continue

        raise RuntimeError(f"Gemini request failed: {message}")

    raise RuntimeError("Gemini request failed after max retries.")


def ensure_entity_exists(supabase: Client, entity: Dict[str, Any]) -> None:
    canonical_key = entity.get("canonical_key")
    if not canonical_key:
        return
    existing = (
        supabase.table("entities")
        .select("entity_id")
        .eq("canonical_key", canonical_key)
        .limit(1)
        .execute()
    )
    if getattr(existing, "error", None):
        raise RuntimeError(f"Supabase query failed: {existing.error}")
    if existing.data:
        return
    insert_payload = {
        "entity_type": entity.get("type"),
        "name": entity.get("name"),
        "canonical_key": canonical_key,
        "source_doc_id": entity.get("source_doc_id"),
        "source_chunk_id": entity.get("source_chunk_id"),
        "metadata": entity.get("metadata", {}),
    }
    result = supabase.table("entities").insert(insert_payload).execute()
    if getattr(result, "error", None):
        raise RuntimeError(f"Supabase insert failed: {result.error}")


def insert_relationship(supabase: Client, relationship: Dict[str, Any], chunk_id: str) -> None:
    source_key = relationship.get("source")
    target_key = relationship.get("target")
    if not source_key or not target_key:
        return

    source_entity = (
        supabase.table("entities").select("entity_id").eq("canonical_key", source_key).limit(1).execute()
    )
    target_entity = (
        supabase.table("entities").select("entity_id").eq("canonical_key", target_key).limit(1).execute()
    )
    if getattr(source_entity, "error", None) or getattr(target_entity, "error", None):
        raise RuntimeError("Supabase lookup failed for relationship endpoints.")
    if not source_entity.data or not target_entity.data:
        return

    payload = {
        "source_entity_id": source_entity.data[0]["entity_id"],
        "target_entity_id": target_entity.data[0]["entity_id"],
        "relationship_type": relationship.get("type"),
        "confidence": 1.0,
        "source_chunk_id": chunk_id,
    }
    result = supabase.table("relationships").insert(payload).execute()
    if getattr(result, "error", None):
        raise RuntimeError(f"Supabase insert failed: {result.error}")


def process_chunks(chunks: List[Dict[str, Any]], api_key: str, supabase: Client) -> None:
    processed = load_processed_chunks()
    processed_ids = set(processed.get("processed_chunk_ids", []))
    total = len(chunks)
    extracted_entities = 0
    mapped_relationships = 0
    skipped_chunks = 0

    for index, chunk in enumerate(chunks, start=1):
        chunk_id = chunk.get("chunk_id")
        if not chunk_id or chunk_id in processed_ids:
            skipped_chunks += 1
            continue

        print(f"Processing chunk {index}/{total}... [doc_id: {chunk.get('doc_id')}, page: {chunk.get('page')}]")
        chunk_text = chunk.get("text", "")
        if not chunk_text.strip():
            processed_ids.add(chunk_id)
            save_processed_chunks({"processed_chunk_ids": list(processed_ids)})
            continue

        try:
            parsed = extract_entities_from_text(chunk_text, api_key)
        except Exception as exc:
            print(f"  Warning: failed to parse chunk {chunk_id}: {exc}")
            continue

        entities = parsed.get("entities", []) or []
        relationships = parsed.get("relationships", []) or []

        for entity in entities:
            entity_payload = {
                "name": entity.get("name"),
                "type": entity.get("type"),
                "canonical_key": entity.get("canonical_key"),
                "source_doc_id": chunk.get("doc_id"),
                "source_chunk_id": chunk_id,
                "metadata": {"page": chunk.get("page"), "doc_type": chunk.get("doc_type")},
            }
            try:
                ensure_entity_exists(supabase, entity_payload)
                extracted_entities += 1
            except Exception as exc:
                print(f"  Warning: entity insert skipped for chunk {chunk_id}: {exc}")

        for relationship in relationships:
            try:
                insert_relationship(supabase, relationship, chunk_id)
                mapped_relationships += 1
            except Exception as exc:
                print(f"  Warning: relationship insert skipped for chunk {chunk_id}: {exc}")

        processed_ids.add(chunk_id)
        save_processed_chunks({"processed_chunk_ids": list(processed_ids)})
        time.sleep(4)  # keep well under free-tier RPM

    print(
        f"Done. {extracted_entities} entities extracted, {mapped_relationships} relationships mapped, "
        f"{skipped_chunks} chunks skipped (already processed)."
    )


def extract_entities_single_doc(doc_id: str) -> None:
    api_key = get_env_variable("GEMINI_API_KEY")
    supabase = create_supabase_client()
    chunks = read_chunks_for_doc(doc_id)
    process_chunks(chunks, api_key, supabase)


def main() -> None:
    api_key = get_env_variable("GEMINI_API_KEY")
    supabase = create_supabase_client()
    chunks = read_chunk_files()
    process_chunks(chunks, api_key, supabase)


if __name__ == "__main__":
    main()