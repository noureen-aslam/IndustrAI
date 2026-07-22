import os
import re
from pathlib import Path

from dotenv import load_dotenv
from supabase import create_client

load_dotenv()

ROOT_DIR = Path(__file__).resolve().parent
RAW_DIR = ROOT_DIR / "data" / "processed" / "raw"
BUCKET_NAME = "documents"


def get_env_variable(name: str) -> str:
    value = os.environ.get(name)
    if not value:
        raise EnvironmentError(f"Missing required environment variable: {name}")
    return value


def sanitize_filename(filename: str) -> str:
    """Must match the sanitize logic used in SourceCard.tsx exactly,
    so generated URLs match the actual Storage keys."""
    # Replace em dash and en dash with a plain hyphen
    result = filename.replace("\u2014", "-").replace("\u2013", "-")
    # Collapse any resulting double spaces/hyphens from the replacement
    result = re.sub(r"\s+", " ", result).strip()
    return result


def main() -> None:
    url = get_env_variable("SUPABASE_URL")
    key = get_env_variable("SUPABASE_KEY")
    supabase = create_client(url, key)

    if not RAW_DIR.exists():
        print(f"Raw directory not found: {RAW_DIR}")
        return

    uploaded = 0
    skipped = 0

    for doc_type_dir in RAW_DIR.iterdir():
        if not doc_type_dir.is_dir():
            continue
        doc_type = doc_type_dir.name

        for pdf_path in doc_type_dir.rglob("*.pdf"):
            safe_name = sanitize_filename(pdf_path.name)
            storage_path = f"{doc_type}/{safe_name}"
            print(f"Uploading {storage_path} ...")

            with open(pdf_path, "rb") as file:
                file_bytes = file.read()

            try:
                supabase.storage.from_(BUCKET_NAME).upload(
                    path=storage_path,
                    file=file_bytes,
                    file_options={"content-type": "application/pdf", "x-upsert": "true"},
                )
                uploaded += 1
            except Exception as exc:
                print(f"  Failed to upload {storage_path}: {exc}")
                skipped += 1

    print(f"Done. Uploaded {uploaded} files, {skipped} failed.")


if __name__ == "__main__":
    main()