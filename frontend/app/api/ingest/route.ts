import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const file = formData.get("file");
    const docType = formData.get("doc_type");

    if (!file || !(file instanceof File)) {
      return NextResponse.json({ error: "File is required." }, { status: 400 });
    }
    if (!docType || typeof docType !== "string") {
      return NextResponse.json({ error: "doc_type is required." }, { status: 400 });
    }
    if (file.type !== "application/pdf") {
      return NextResponse.json({ error: "Only PDF files are allowed." }, { status: 400 });
    }
    if (file.size > 50 * 1024 * 1024) {
      return NextResponse.json({ error: "File size must be 50MB or smaller." }, { status: 400 });
    }

    const filename = `${docType}/${file.name}`;
    const { data, error: storageError } = await supabase.storage
      .from("documents")
      .upload(filename, file, { upsert: true });
    if (storageError) {
      throw storageError;
    }

    const docId = `${docType}_${file.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
    const documentRecord = {
      doc_id: docId,
      filename: file.name,
      doc_type: docType,
      extraction_method: "pending",
      num_pages: 0,
      storage_path: data.path,
      uploaded_by: "web_upload",
      processed_at: new Date().toISOString(),
    };

    const { error: insertError } = await supabase.from("documents").insert(documentRecord);
    if (insertError) {
      throw insertError;
    }

    return NextResponse.json({
      success: true,
      doc_id: docId,
      storage_path: data.path,
      message: "Document uploaded. Ingestion will process within 5 minutes via the watcher service.",
    });
  } catch (error: unknown) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
