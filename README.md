# IndustrAI

IndustrAI is a private industrial document intelligence platform built for the ET AI Hackathon 2026.
It ingests manuals, regulations, inspection forms, and P&ID drawings into Supabase, extracts entities and relationships with Claude, detects contradictions across documents, and exposes a Next.js frontend for querying and visualization.

## Project structure

- `pipeline/` — Python ingestion, embedding, entity extraction, watcher, contradiction detection.
- `frontend/` — Next.js 15 app router frontend, Supabase API routes, and visualization UI.

## Setup

### Pipeline

```bash
cd pipeline
pip install -r requirements.txt
cp .env.example .env
```

Fill in `SUPABASE_URL`, `SUPABASE_KEY`, and `ANTHROPIC_API_KEY` in `pipeline/.env`.

### Frontend

```bash
cd frontend
npm install
cp .env.local.example .env.local
```

Fill in the environment variables in `frontend/.env.local`.

## Supabase schema

1. Open Supabase SQL editor.
2. Run `pipeline/supabase/schema.sql`.
3. Run `pipeline/supabase/schema_additions.sql`.

## Running the pipeline

```bash
cd pipeline
python ingest.py
python embed_and_upload.py
python extract_entities.py
python contradiction_detector.py
```

### Watcher

```bash
cd pipeline
python watcher.py
```

The watcher polls `pipeline/data/raw/` every `WATCH_INTERVAL_SECONDS` and runs ingestion, embedding, and entity extraction for new or modified PDFs.

## Frontend

```bash
cd frontend
npm run dev
```

Open `http://localhost:3000`.

## Notes

- The Python pipeline uses `sentence-transformers` `all-MiniLM-L6-v2` for document embeddings.
- The frontend query route uses Cohere `embed-english-light-v3.0` to generate runtime embeddings compatible with the same 384-dim embedding size.
- All Supabase writes use upsert semantics where applicable.
- The watcher and detector scripts require environment variables from `pipeline/.env`.
