export interface Document {
  doc_id: string;
  filename: string;
  doc_type: string;
  extraction_method: string;
  num_pages: number;
  processed_at: string;
  num_chunks?: number;
}

export interface Chunk {
  chunk_id: string;
  doc_id: string;
  page: number;
  text: string;
  word_count: number;
}

export interface Entity {
  entity_id: string;
  entity_type: "equipment" | "regulation_clause" | "procedure" | "location" | "personnel";
  name: string;
  canonical_key: string;
  source_doc_id: string;
  metadata: Record<string, unknown>;
}

export interface Relationship {
  relationship_id: string;
  source_entity_id: string;
  target_entity_id: string;
  relationship_type: string;
  confidence: number;
}

export interface QueryResult {
  answer: string;
  sources: Array<{
    doc_id: string;
    page: number;
    similarity: number;
  }>;
  confidence: number;
}

export interface Contradiction {
  contradiction_id: string;
  entity_name: string;
  claim_type: string;
  doc_id_a: string;
  page_a: number;
  claim_a: string;
  doc_id_b: string;
  page_b: number;
  claim_b: string;
  severity: "high" | "medium" | "low";
  reason: string;
  detected_at: string;
}

export interface GraphNode {
  id: string;
  name: string;
  type: string;
}

export interface GraphLink {
  source: string;
  target: string;
  type: string;
}

export interface GraphData {
  nodes: GraphNode[];
  links: GraphLink[];
}
