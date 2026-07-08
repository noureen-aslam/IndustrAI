import json
import os
import re
from pathlib import Path
from typing import Any, Dict, List

from anthropic import Anthropic
from supabase import Client, create_client

DATA_DIR = Path(__file__).resolve().parent / "data"
PROCESSED_CHUNKS_PATH = DATA_DIR / "processed" / "processed_chunks.json"
CHUNKS_DIR = DATA_DIR / "processed" / "chunks"

SYSTEM_PROMPT = (
    "You are an industrial knowledge extraction system. Extract entities and relationships from the provided industrial document chunk. "
    "Respond ONLY with valid JSON, no markdown, no explanation, no preamble. Use this exact schema:\n"
    "{\n"
    "  'entities': [{'name': 'string', 'type': 'equipment|regulation_clause|procedure|location|personnel', 'canonical_key': 'string'}],\n"
    "  'relationships': [{'source': 'canonical_key', 'target': 'canonical_key', 'type': 'governed_by|inspected_in|maintained_by|references|located_in|requires'}]\n"
    "}\n"
    "canonical_key must be lowercase, underscores only, no special characters. Example: 'pump_cp_450', 'oisd_std_118_clause_4_2'. "
    "Only extract entities explicitly mentioned. If no entities found, return {'entities': [], 'relationships': []}."
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
    try:
        cleaned = raw.strip()
        if cleaned.startswith("```") and cleaned.endswith("```"):
            cleaned = cleaned.strip("`\n")
        return json.loads(cleaned)
    except json.JSONDecodeError:
        # Some Claude responses use single quotes; normalize to double quotes safely when possible.
        normalized = re.sub(r"(?<!\\)'", '"', raw)
        normalized = normalized.replace("\"\"", '"')
        try:
            return json.loads(normalized)
        except json.JSONDecodeError:
            raise


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


def extract_entities_from_text(anthropic: Anthropic, chunk_text: str) -> Dict[str, Any]:
    response = anthropic.completions.create(
        model="claude-sonnet-4-6",
        prompt=f"{SYSTEM_PROMPT}\n\n{chunk_text}",
        max_tokens_to_sample=600,
        temperature=0.0,
        stop_sequences=["\n\n"],
    )
    content = response.get("completion", "").strip()
    return safe_parse_json(content)


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


def extract_entities_single_doc(doc_id: str) -> None:
    anthropic_api_key = get_env_variable("ANTHROPIC_API_KEY")
    anthropic = Anthropic(api_key=anthropic_api_key)
    supabase = create_supabase_client()
    chunks = read_chunks_for_doc(doc_id)
    processed = load_processed_chunks()
    processed_ids = set(processed.get("processed_chunk_ids", []))
    extracted_entities = 0
    mapped_relationships = 0

    for index, chunk in enumerate(chunks, start=1):
        chunk_id = chunk.get("chunk_id")
        if not chunk_id or chunk_id in processed_ids:
            continue
        print(
            f"Processing chunk {index}/{len(chunks)}... [doc_id: {chunk.get('doc_id')}, page: {chunk.get('page')}]"
        )
        chunk_text = chunk.get("text", "")
        if not chunk_text.strip():
            processed_ids.add(chunk_id)
            save_processed_chunks({"processed_chunk_ids": list(processed_ids)})
            continue
        try:
            parsed = extract_entities_from_text(anthropic, chunk_text)
        except Exception as exc:
            print(f"Warning: failed to parse chunk {chunk_id}: {exc}")
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
                "metadata": {
                    "page": chunk.get("page"),
                    "doc_type": chunk.get("doc_type"),
                },
            }
            try:
                ensure_entity_exists(supabase, entity_payload)
                extracted_entities += 1
            except Exception as exc:
                print(f"Warning: entity insert skipped for chunk {chunk_id}: {exc}")
        for relationship in relationships:
            try:
                insert_relationship(supabase, relationship, chunk_id)
                mapped_relationships += 1
            except Exception as exc:
                print(f"Warning: relationship insert skipped for chunk {chunk_id}: {exc}")
        processed_ids.add(chunk_id)
        save_processed_chunks({"processed_chunk_ids": list(processed_ids)})

    print(
        f"Done. {extracted_entities} entities extracted, {mapped_relationships} relationships mapped for document {doc_id}."
    )


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
    if existing.error:
        raise RuntimeError(f"Supabase query failed: {existing.error.message}")
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
    upsert_result = (
        supabase.table("entities")
        .insert(insert_payload)
        .execute()
    )
    if upsert_result.error:
        raise RuntimeError(f"Supabase insert failed: {upsert_result.error.message}")


def insert_relationship(supabase: Client, relationship: Dict[str, Any], chunk_id: str) -> None:
    source_key = relationship.get("source")
    target_key = relationship.get("target")
    if not source_key or not target_key:
        return
    source_entity = (
        supabase.table("entities")
        .select("entity_id")
        .eq("canonical_key", source_key)
        .limit(1)
        .execute()
    )
    target_entity = (
        supabase.table("entities")
        .select("entity_id")
        .eq("canonical_key", target_key)
        .limit(1)
        .execute()
    )
    if source_entity.error or target_entity.error:
        raise RuntimeError(
            f"Supabase lookup failed: {source_entity.error.message if source_entity.error else ''} "
            f"{target_entity.error.message if target_entity.error else ''}"
        )
    if not source_entity.data or not target_entity.data:
        return
    payload = {
        "source_entity_id": source_entity.data[0]["entity_id"],
        "target_entity_id": target_entity.data[0]["entity_id"],
        "relationship_type": relationship.get("type"),
        "confidence": 1.0,
        "source_chunk_id": chunk_id,
    }
    upsert_result = (
        supabase.table("relationships")
        .insert(payload)
        .execute()
    )
    if upsert_result.error:
        raise RuntimeError(f"Supabase insert failed: {upsert_result.error.message}")


def main() -> None:
    anthropic_api_key = get_env_variable("ANTHROPIC_API_KEY")
    anthropic = Anthropic(api_key=anthropic_api_key)
    supabase = create_supabase_client()
    processed = load_processed_chunks()
    processed_ids = set(processed.get("processed_chunk_ids", []))
    chunks = read_chunk_files()

    total_chunks = len(chunks)
    extracted_entities = 0
    mapped_relationships = 0
    skipped_chunks = 0

    for index, chunk in enumerate(chunks, start=1):
        chunk_id = chunk.get("chunk_id")
        if not chunk_id or chunk_id in processed_ids:
            skipped_chunks += 1
            continue

        print(
            f"Processing chunk {index}/{total_chunks}... [doc_id: {chunk.get('doc_id')}, page: {chunk.get('page')}]"
        )
        chunk_text = chunk.get("text", "")
        if not chunk_text.strip():
            processed_ids.add(chunk_id)
            save_processed_chunks({"processed_chunk_ids": list(processed_ids)})
            continue

        try:
            parsed = extract_entities_from_text(anthropic, chunk_text)
        except Exception as exc:
            print(f"Warning: failed to parse chunk {chunk_id}: {exc}")
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
                "metadata": {
                    "page": chunk.get("page"),
                    "doc_type": chunk.get("doc_type"),
                },
            }
            try:
                ensure_entity_exists(supabase, entity_payload)
                extracted_entities += 1
            except Exception as exc:
                print(f"Warning: entity insert skipped for chunk {chunk_id}: {exc}")

        for relationship in relationships:
            try:
                insert_relationship(supabase, relationship, chunk_id)
                mapped_relationships += 1
            except Exception as exc:
                print(f"Warning: relationship insert skipped for chunk {chunk_id}: {exc}")

        processed_ids.add(chunk_id)
        save_processed_chunks({"processed_chunk_ids": list(processed_ids)})

    print(
        f"Done. {extracted_entities} entities extracted, {mapped_relationships} relationships mapped, {skipped_chunks} chunks skipped (already processed)."
    )


if __name__ == "__main__":
    main()
