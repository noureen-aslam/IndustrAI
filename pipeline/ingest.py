import json
import os
import re
from datetime import datetime
from hashlib import sha1
from pathlib import Path
from typing import Dict, List, Optional, Tuple

import fitz
import pytesseract
from pdf2image import convert_from_path

ROOT_DIR = Path(__file__).resolve().parent
DATA_RAW_DIR = ROOT_DIR / "data" / "raw"
DATA_PROCESSED_DIR = ROOT_DIR / "data" / "processed"
CHUNKS_DIR = DATA_PROCESSED_DIR / "chunks"
TEXT_EXTRACTED_DIR = DATA_PROCESSED_DIR / "text_extracted"
DOCUMENT_INDEX_PATH = DATA_PROCESSED_DIR / "document_index.json"

HEADING_PATTERN = re.compile(
    r"(?m)^(?:Section\s+\d+(?:\.\d+)*|Clause\s+\d+(?:\.\d+)*|\d+(?:\.\d+)+)\b"
)


def read_document_index() -> Dict[str, Dict[str, any]]:
    if not DOCUMENT_INDEX_PATH.exists():
        return {}
    try:
        with open(DOCUMENT_INDEX_PATH, "r", encoding="utf-8") as handle:
            return json.load(handle)
    except json.JSONDecodeError:
        return {}


def write_document_index(index: Dict[str, Dict[str, any]]) -> None:
    DOCUMENT_INDEX_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(DOCUMENT_INDEX_PATH, "w", encoding="utf-8") as handle:
        json.dump(index, handle, indent=2)


def sanitize_doc_id(raw: str) -> str:
    cleaned = re.sub(r"[^a-zA-Z0-9_]+", "_", raw.lower()).strip("_")
    return re.sub(r"_+", "_", cleaned)


def extract_text_from_page(doc: fitz.Document, page_number: int) -> Tuple[str, str]:
    page = doc.load_page(page_number)
    text = page.get_text("text").strip()
    if len(text) >= 200:
        return text, "pymupdf"

    images = convert_from_path(doc.name, first_page=page_number + 1, last_page=page_number + 1)
    if not images:
        return text, "pymupdf"

    ocr_text = pytesseract.image_to_string(images[0]).strip()
    return (ocr_text if len(ocr_text) > len(text) else text), ("ocr" if len(ocr_text) >= 200 else "pymupdf")


def split_into_chunks(text: str, page: int, doc_id: str, filename: str) -> List[Dict[str, any]]:
    segments = []
    parts = HEADING_PATTERN.split(text)
    if len(parts) > 1:
        cursor = 0
        for part in parts:
            part = part.strip()
            if part:
                segments.append(part)
            cursor += len(part)
    if not segments:
        segments = [text.strip()]

    chunks = []
    tokenized = []
    for segment in segments:
        words = segment.split()
        if len(words) <= 180:
            tokenized.append(segment)
            continue

        for start in range(0, len(words), 155):
            end = min(start + 180, len(words))
            chunk_text = " ".join(words[start:end]).strip()
            if chunk_text:
                tokenized.append(chunk_text)
            if end == len(words):
                break

    for idx, chunk_text in enumerate(tokenized, start=1):
        word_count = len(chunk_text.split())
        chunk_id = f"{doc_id}_p{page}_{idx}"
        chunks.append(
            {
                "chunk_id": chunk_id,
                "doc_id": doc_id,
                "filename": filename,
                "doc_type": filename.split("/")[0] if "/" in filename else filename,
                "page": page,
                "text": chunk_text,
                "word_count": word_count,
            }
        )
    return chunks


def generate_doc_id(file_path: Path, doc_type: str) -> str:
    normalized = sanitize_doc_id(file_path.stem)
    digest = sha1(str(file_path.resolve()).encode("utf-8")).hexdigest()[:8]
    return f"{sanitize_doc_id(doc_type)}_{normalized}_{digest}"


def process_file(file_path: Path, doc_type: str) -> Dict[str, any]:
    file_path = file_path.resolve()
    doc = fitz.open(str(file_path))
    filename = file_path.name
    doc_id = generate_doc_id(file_path, doc_type)
    pages = []
    chunk_entries = []
    extraction_methods = set()

    for page_number in range(doc.page_count):
        page_text, method = extract_text_from_page(doc, page_number)
        extraction_methods.add(method)
        pages.append(
            {
                "page": page_number + 1,
                "text": page_text,
                "extraction_method": method,
            }
        )
        if page_text.strip():
            chunk_entries.extend(split_into_chunks(page_text, page_number + 1, doc_id, filename))

    TEXT_EXTRACTED_DIR.mkdir(parents=True, exist_ok=True)
    CHUNKS_DIR.mkdir(parents=True, exist_ok=True)
    with open(TEXT_EXTRACTED_DIR / f"{doc_id}_text.json", "w", encoding="utf-8") as handle:
        json.dump({"doc_id": doc_id, "filename": filename, "pages": pages}, handle, indent=2)

    chunk_file = CHUNKS_DIR / f"{doc_id}_chunks.json"
    with open(chunk_file, "w", encoding="utf-8") as handle:
        json.dump(chunk_entries, handle, indent=2)

    document_index = read_document_index()
    document_index[doc_id] = {
        "doc_id": doc_id,
        "filename": filename,
        "doc_type": doc_type,
        "extraction_method": ",".join(sorted(extraction_methods)),
        "num_pages": doc.page_count,
        "storage_path": str(file_path),
        "uploaded_by": "pipeline_ingest",
        "processed_at": datetime.utcnow().isoformat() + "Z",
        "modified_at": datetime.utcfromtimestamp(file_path.stat().st_mtime).isoformat() + "Z",
    }
    write_document_index(document_index)

    return {
        "doc_id": doc_id,
        "filename": filename,
        "doc_type": doc_type,
        "num_pages": doc.page_count,
        "chunk_count": len(chunk_entries),
    }


def scan_raw_documents() -> List[Tuple[Path, str]]:
    candidates = []
    for doc_type_dir in DATA_RAW_DIR.iterdir():
        if not doc_type_dir.is_dir():
            continue
        for file_path in doc_type_dir.rglob("*.pdf"):
            candidates.append((file_path, doc_type_dir.name))
    return sorted(candidates, key=lambda item: str(item[0]))


def main() -> None:
    processed_index = read_document_index()
    pdf_files = scan_raw_documents()
    if not pdf_files:
        print("No PDF documents found in data/raw/.")
        return

    for file_path, doc_type in pdf_files:
        doc_id = next(
            (entry["doc_id"] for entry in processed_index.values() if entry["storage_path"] == str(file_path)),
            None,
        )
        if doc_id:
            previous_mtime = processed_index[doc_id].get("modified_at")
            current_mtime = datetime.utcfromtimestamp(file_path.stat().st_mtime).isoformat() + "Z"
            if current_mtime == previous_mtime:
                print(f"Skipping unchanged file: {file_path.name}")
                continue

        result = process_file(file_path, doc_type)
        print(f"Processed {result['filename']} ({result['chunk_count']} chunks)")


if __name__ == "__main__":
    main()
