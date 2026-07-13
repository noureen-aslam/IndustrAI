import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

let _supabaseAdmin: ReturnType<typeof createClient> | null = null;
if (supabaseUrl && supabaseServiceRoleKey) {
  _supabaseAdmin = createClient(supabaseUrl, supabaseServiceRoleKey, {
    auth: { persistSession: false },
  });
} else {
  // Avoid throwing during build-time; some environments may only provide secrets at runtime.
  // Accessing the client when not configured will surface a clear error.
  // eslint-disable-next-line no-console
  console.warn("SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY not set; supabaseAdmin will be unavailable until runtime.");
}

// Use `any` for the admin client to avoid strict RPC typing issues during build-time.
// The runtime client is still created correctly when environment variables are present.
export const supabaseAdmin: any = _supabaseAdmin as any;
