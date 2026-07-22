import os
from collections import defaultdict
from itertools import combinations
from pathlib import Path
from typing import Any, Dict, List, Tuple

from dotenv import load_dotenv
from supabase import Client, create_client

ROOT_DIR = Path(__file__).resolve().parent
load_dotenv(dotenv_path=ROOT_DIR / ".env")

# (type_a, type_b) -> (relationship_type, direction)
# direction True  => source is the type_a entity, target is the type_b entity
# direction False => source is the type_b entity, target is the type_a entity
TYPE_PAIR_RULES: Dict[Tuple[str, str], Tuple[str, bool]] = {
    ("equipment", "regulation_clause"): ("governed_by", True),
    ("equipment", "location"): ("located_in", True),
    ("equipment", "personnel"): ("maintained_by", False),
    ("equipment", "procedure"): ("requires", True),
    ("procedure", "regulation_clause"): ("governed_by", True),
    ("procedure", "personnel"): ("maintained_by", False),
    ("procedure", "location"): ("inspected_in", True),
    ("regulation_clause", "location"): ("references", True),
    ("personnel", "location"): ("located_in", True),
}
DEFAULT_TYPE = "references"


def get_env_variable(name: str) -> str:
    value = os.environ.get(name)
    if not value:
        raise EnvironmentError(f"Missing required environment variable: {name}")
    return value


def create_supabase_client() -> Client:
    url = get_env_variable("SUPABASE_URL")
    key = get_env_variable("SUPABASE_KEY")
    return create_client(url, key)


def infer_relationship_type(type_a: str, type_b: str) -> Tuple[str, bool]:
    if (type_a, type_b) in TYPE_PAIR_RULES:
        return TYPE_PAIR_RULES[(type_a, type_b)]
    if (type_b, type_a) in TYPE_PAIR_RULES:
        rel_type, direction = TYPE_PAIR_RULES[(type_b, type_a)]
        return rel_type, not direction
    return DEFAULT_TYPE, True


def main() -> None:
    supabase = create_supabase_client()

    entities_response = (
        supabase.table("entities")
        .select("entity_id,entity_type,source_chunk_id")
        .execute()
    )
    if getattr(entities_response, "error", None):
        raise RuntimeError(f"Failed to fetch entities: {entities_response.error}")
    entities = entities_response.data or []

    existing_response = (
        supabase.table("relationships")
        .select("source_entity_id,target_entity_id,relationship_type")
        .execute()
    )
    if getattr(existing_response, "error", None):
        raise RuntimeError(f"Failed to fetch existing relationships: {existing_response.error}")
    existing_pairs = {
        (row["source_entity_id"], row["target_entity_id"], row["relationship_type"])
        for row in (existing_response.data or [])
    }

    chunks: Dict[str, List[Dict[str, Any]]] = defaultdict(list)
    for entity in entities:
        chunk_id = entity.get("source_chunk_id")
        if chunk_id:
            chunks[chunk_id].append(entity)

    new_rows: List[Dict[str, Any]] = []
    seen_this_run = set()

    for chunk_id, chunk_entities in chunks.items():
        if len(chunk_entities) < 2:
            continue
        for entity_a, entity_b in combinations(chunk_entities, 2):
            if entity_a["entity_id"] == entity_b["entity_id"]:
                continue
            rel_type, a_is_source = infer_relationship_type(
                entity_a["entity_type"], entity_b["entity_type"]
            )
            source = entity_a if a_is_source else entity_b
            target = entity_b if a_is_source else entity_a
            key = (source["entity_id"], target["entity_id"], rel_type)

            if key in existing_pairs or key in seen_this_run:
                continue
            seen_this_run.add(key)

            new_rows.append({
                "source_entity_id": source["entity_id"],
                "target_entity_id": target["entity_id"],
                "relationship_type": rel_type,
                "confidence": 0.6,  # heuristic, not model-verified
                "source_chunk_id": chunk_id,
            })

    if not new_rows:
        print("No new relationships to add.")
        return

    for i in range(0, len(new_rows), 200):
        batch = new_rows[i : i + 200]
        result = supabase.table("relationships").insert(batch).execute()
        if getattr(result, "error", None):
            raise RuntimeError(f"Failed to insert relationships batch: {result.error}")

    print(f"Added {len(new_rows)} heuristic relationships across {len(chunks)} chunks.")


if __name__ == "__main__":
    main()