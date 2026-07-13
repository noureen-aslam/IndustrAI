import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";

export async function GET() {
  try {
    const response = await supabaseAdmin
      .from("documents")
      .select(`doc_id,filename,doc_type,extraction_method,num_pages,processed_at`)
      .order("processed_at", { ascending: false });
    if (response.error) {
      throw response.error;
    }
    const documents = response.data ?? [];

    const chunkRowsResponse = await supabaseAdmin.from("chunks").select("doc_id");
    if (chunkRowsResponse.error) {
      throw chunkRowsResponse.error;
    }
    const counts = (chunkRowsResponse.data ?? []).reduce((acc: Record<string, number>, row: any) => {
      if (row.doc_id) {
        acc[row.doc_id] = (acc[row.doc_id] || 0) + 1;
      }
      return acc;
    }, {} as Record<string, number>);

    const payload = documents.map((document: any) => ({
      ...document,
      num_chunks: counts[document.doc_id] ?? 0,
    }));
    return NextResponse.json(payload);
  } catch (error: unknown) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
