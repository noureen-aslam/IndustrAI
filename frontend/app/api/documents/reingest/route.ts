import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";

interface RequestBody {
  doc_id: string;
}

export async function POST(request: Request) {
  try {
    const payload = (await request.json()) as RequestBody;
    if (!payload.doc_id) {
      return NextResponse.json({ error: "doc_id is required." }, { status: 400 });
    }

    const chunksResponse = await supabaseAdmin.from("chunks").select("chunk_id").eq("doc_id", payload.doc_id);
    if (chunksResponse.error) {
      throw chunksResponse.error;
    }
    const chunkIds = (chunksResponse.data ?? []).map((item) => item.chunk_id);

    if (chunkIds.length) {
      const relResponse = await supabaseAdmin.from("relationships").delete().in_("source_chunk_id", chunkIds);
      if (relResponse.error) {
        throw relResponse.error;
      }
    }

    const chunkDelete = await supabaseAdmin.from("chunks").delete().eq("doc_id", payload.doc_id);
    if (chunkDelete.error) {
      throw chunkDelete.error;
    }

    const entityDelete = await supabaseAdmin.from("entities").delete().eq("source_doc_id", payload.doc_id);
    if (entityDelete.error) {
      throw entityDelete.error;
    }

    const documentUpdate = await supabaseAdmin
      .from("documents")
      .update({ extraction_method: "pending", processed_at: new Date().toISOString() })
      .eq("doc_id", payload.doc_id);
    if (documentUpdate.error) {
      throw documentUpdate.error;
    }

    return NextResponse.json({ success: true, message: "Re-ingestion request submitted." });
  } catch (error: unknown) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
