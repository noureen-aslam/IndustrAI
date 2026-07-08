import hashlib
import json
import os
from pathlib import Path
from typing import Any, Dict, List, Optional

from anthropic import Anthropic
from supabase import Client, create_client

ROOT_DIR = Path(__file__).resolve().parent
DATA_DIR = ROOT_DIR / "data"
CONTRA_PATH = DATA_DIR / "processed" / "contradictions.json"

PROMPT = (
    "You are a safety-critical industrial document analysis system. You will be given multiple text excerpts about the same piece of equipment from different source documents. "
    "Identify any contradictions or conflicts between them — especially regarding maintenance intervals, pressure/temperature thresholds, inspection frequencies, operating limits, or safety procedures.\n\n"
    "Respond ONLY with valid JSON, no markdown:\n"
    "{\n"
    "  'contradictions': [\n"
    "    {\n"
    "      'entity': 'equipment name',\n"
    "      'claim_type': 'maintenance interval|pressure threshold|temperature limit|inspection frequency|operating procedure|safety requirement',\n"
    "      'source_a': {'doc_id': '...', 'page': 0, 'claim': 'exact relevant quote'},\n"
    "      'source_b': {'doc_id': '...', 'page': 0, 'claim': 'exact relevant quote'},\n"
    "      'severity': 'high|medium|low',\n"
    "      'reason': 'one sentence explaining why this is a contradiction'\n"
    "    }\n"
    "  ]\n"
    "}\n\n"
    "Severity guide: high = directly contradicts a safety-critical value (pressure limit, evacuation threshold); medium = contradicts maintenance timing or inspection frequency; low = ambiguous or minor procedural difference.\n"
    "If no contradictions found, return {'contradictions': []}.\n"
    "Do not invent contradictions. Only flag genuine conflicts."
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


def safe_parse_json(raw: str) -> Dict[str, Any]:
    try:
        cleaned = raw.strip()
        if cleaned.startswith("```") and cleaned.endswith("```"):
            cleaned = cleaned.strip("`\n")
        return json.loads(cleaned)
    except json.JSONDecodeError:
        normalized = raw.replace("'", '"')
        return json.loads(normalized)


def hash_uuid(value: str) -> str:
    digest = hashlib.sha1(value.encode("utf-8")).hexdigest()
    return f"{digest[:8]}-{digest[8:12]}-{digest[12:16]}-{digest[16:20]}-{digest[20:32]}"


def load_equipment_entities(supabase: Client) -> List[Dict[str, Any]]:
    response = supabase.table("entities").select("entity_id,name,canonical_key").eq("entity_type", "equipment").execute()
    if response.error:
        raise RuntimeError(f"Failed to fetch equipment entities: {response.error.message}")
    return response.data or []


def load_chunk_texts(supabase: Client, chunk_ids: List[str]) -> List[Dict[str, Any]]:
    if not chunk_ids:
        return []
    response = supabase.table("chunks").select("chunk_id,doc_id,page,text").in_("chunk_id", chunk_ids).execute()
    if response.error:
        raise RuntimeError(f"Failed to fetch chunk texts: {response.error.message}")
    return response.data or []


def fetch_conflicting_chunks(supabase: Client, entity_id: str) -> List[Dict[str, Any]]:
    response = (
        supabase.table("relationships")
        .select("source_chunk_id")
        .or_(f"source_entity_id.eq.{entity_id},target_entity_id.eq.{entity_id}")
        .execute()
    )
    if response.error:
        raise RuntimeError(f"Failed to fetch relationship chunk ids: {response.error.message}")
    return [row["source_chunk_id"] for row in (response.data or []) if row.get("source_chunk_id")]


def build_context(chunks: List[Dict[str, Any]]) -> str:
    return "\n\n".join(
        f"DOC: {chunk['doc_id']} PAGE: {chunk['page']}\n{chunk['text']}" for chunk in chunks
    )


def call_claude(anthropic: Anthropic, context: str, entity_name: str) -> Dict[str, Any]:
    prompt = f"{PROMPT}\n\nEQUIPMENT: {entity_name}\n\nEXCERPTS:\n{context}\n"
    response = anthropic.completions.create(
        model="claude-sonnet-4-6",
        prompt=prompt,
        max_tokens_to_sample=700,
        temperature=0.0,
        stop_sequences=["\n\n"],
    )
    content = response.get("completion", "").strip()
    return safe_parse_json(content)


def upsert_contradictions(supabase: Client, contradictions: List[Dict[str, Any]]) -> None:
    if not contradictions:
        return
    rows: List[Dict[str, Any]] = []
    for contradiction in contradictions:
        unique_input = (
            f"{contradiction['entity_name']}|{contradiction['claim_type']}|{contradiction['claim_a']}|{contradiction['claim_b']}"
        )
        rows.append({
            "contradiction_id": hash_uuid(unique_input),
            "entity_name": contradiction["entity_name"],
            "claim_type": contradiction["claim_type"],
            "doc_id_a": contradiction["doc_id_a"],
            "page_a": contradiction.get("page_a"),
            "claim_a": contradiction["claim_a"],
            "doc_id_b": contradiction["doc_id_b"],
            "page_b": contradiction.get("page_b"),
            "claim_b": contradiction["claim_b"],
            "severity": contradiction["severity"],
            "reason": contradiction["reason"],
        })
    response = supabase.table("contradictions").upsert(rows, on_conflict="contradiction_id").execute()
    if response.error:
        raise RuntimeError(f"Failed to upsert contradictions: {response.error.message}")


def save_contradictions_file(contradictions: List[Dict[str, Any]]) -> None:
    CONTRA_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(CONTRA_PATH, "w", encoding="utf-8") as handle:
        json.dump({"contradictions": contradictions}, handle, indent=2)


def normalize_contradiction(raw: Dict[str, Any], entity_name: str) -> Optional[Dict[str, Any]]:
    source_a = raw.get("source_a", {})
    source_b = raw.get("source_b", {})
    if not source_a or not source_b:
        return None
    return {
        "entity_name": entity_name,
        "claim_type": raw.get("claim_type", "operating procedure"),
        "doc_id_a": source_a.get("doc_id"),
        "page_a": source_a.get("page"),
        "claim_a": source_a.get("claim", ""),
        "doc_id_b": source_b.get("doc_id"),
        "page_b": source_b.get("page"),
        "claim_b": source_b.get("claim", ""),
        "severity": raw.get("severity", "low"),
        "reason": raw.get("reason", "")[:300],
    }


def main() -> None:
    anthropic_api_key = get_env_variable("ANTHROPIC_API_KEY")
    anthropic = Anthropic(api_key=anthropic_api_key)
    supabase = create_supabase_client()

    equipment_entities = load_equipment_entities(supabase)
    contradictions: List[Dict[str, Any]] = []
    checked = 0
    severity_counts = {"high": 0, "medium": 0, "low": 0}

    for entity in equipment_entities:
        checked += 1
        entity_id = entity["entity_id"]
        entity_name = entity["name"]
        chunk_ids = fetch_conflicting_chunks(supabase, entity_id)
        if not chunk_ids:
            continue
        chunks = load_chunk_texts(supabase, chunk_ids)
        docs = {chunk["doc_id"] for chunk in chunks}
        if len(docs) < 2:
            continue
        context = build_context(chunks)
        try:
            parsed = call_claude(anthropic, context, entity_name)
        except Exception:
            continue
        raw_contradictions = parsed.get("contradictions", []) or []
        for raw in raw_contradictions:
            normalized = normalize_contradiction(raw, entity_name)
            if normalized:
                contradictions.append(normalized)
                severity = normalized["severity"]
                if severity in severity_counts:
                    severity_counts[severity] += 1

    upsert_contradictions(supabase, contradictions)
    save_contradictions_file(contradictions)

    print(
        f"Checked {checked} equipment entities. Found {len(contradictions)} contradictions "
        f"({severity_counts['high']} high, {severity_counts['medium']} medium, {severity_counts['low']} low)."
    )


if __name__ == "__main__":
    main()
