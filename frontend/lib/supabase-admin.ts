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

export const supabaseAdmin = _supabaseAdmin as unknown as ReturnType<typeof createClient>;
