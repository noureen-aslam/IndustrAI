import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const severity = url.searchParams.get("severity");
    let query = supabaseAdmin.from("contradictions").select("*").order("detected_at", { ascending: false });
    if (severity) {
      query = query.eq("severity", severity);
    }
    const response = await query;
    if (response.error) {
      throw response.error;
    }
    return NextResponse.json(response.data ?? []);
  } catch (error: unknown) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
