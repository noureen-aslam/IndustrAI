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
