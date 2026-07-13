import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";

export async function GET() {
  try {
    const entitiesResponse = await supabaseAdmin
      .from("entities")
      .select("entity_id,entity_type,name,canonical_key");
    if (entitiesResponse.error) {
      throw entitiesResponse.error;
    }

    const relationshipsResponse = await supabaseAdmin
      .from("relationships")
      .select("source_entity_id,target_entity_id,relationship_type");
    if (relationshipsResponse.error) {
      throw relationshipsResponse.error;
    }

    const nodes = (entitiesResponse.data ?? []).map((entity: any) => ({
      id: entity.entity_id,
      name: entity.name,
      type: entity.entity_type,
    }));

    const links = (relationshipsResponse.data ?? []).map((relationship: any) => ({
      source: relationship.source_entity_id,
      target: relationship.target_entity_id,
      type: relationship.relationship_type,
    }));

    return NextResponse.json({ nodes, links });
  } catch (error: unknown) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
