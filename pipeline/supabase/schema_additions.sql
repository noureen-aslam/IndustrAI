-- Enable pgvector
create extension if not exists vector;

-- Documents table (matches document_index.json fields written by ingest.py)
create table if not exists documents (
    doc_id text primary key,
    filename text not null,
    doc_type text,
    extraction_method text,
    num_pages integer,
    storage_path text,
    uploaded_by text,
    processed_at timestamptz,
    modified_at timestamptz
);

-- Chunks table (matches rows built by embed_and_upload.py)
create table if not exists chunks (
    chunk_id text primary key,
    doc_id text references documents(doc_id) on delete cascade,
    page integer,
    text text not null,
    word_count integer,
    embedding vector(384)
);

create index if not exists chunks_doc_id_idx on chunks (doc_id);
-- ivfflat index for fast similarity search (run analyze after bulk insert)
create index if not exists chunks_embedding_idx on chunks
    using ivfflat (embedding vector_cosine_ops) with (lists = 100);

-- Query log table (matches insert in frontend route.ts)
create table if not exists query_log (
    id uuid primary key default gen_random_uuid(),
    user_id text,
    question text not null,
    answer text,
    cited_chunk_ids text[],
    confidence_score float,
    created_at timestamptz default now()
);

-- Contradictions table (from schema_additions.sql)
create table if not exists contradictions (
    contradiction_id uuid primary key default gen_random_uuid(),
    entity_name text not null,
    claim_type text not null,
    doc_id_a text references documents(doc_id),
    page_a integer,
    claim_a text,
    doc_id_b text references documents(doc_id),
    page_b integer,
    claim_b text,
    severity text check (severity in ('high', 'medium', 'low')),
    reason text,
    detected_at timestamptz default now()
);
create index if not exists contradictions_entity_idx on contradictions (entity_name);
create index if not exists contradictions_severity_idx on contradictions (severity);

-- match_chunks function (matches call in frontend route.ts)
create or replace function match_chunks(
    query_embedding vector(384),
    match_count int,
    filter_doc_type text default null
)
returns table (
    chunk_id text,
    doc_id text,
    page int,
    text text,
    similarity float
)
language sql stable
as $$
    select
        chunks.chunk_id,
        chunks.doc_id,
        chunks.page,
        chunks.text,
        1 - (chunks.embedding <=> query_embedding) as similarity
    from chunks
    join documents on documents.doc_id = chunks.doc_id
    where filter_doc_type is null or documents.doc_type = filter_doc_type
    order by chunks.embedding <=> query_embedding
    limit match_count;
$$;

notify pgrst, 'reload schema';