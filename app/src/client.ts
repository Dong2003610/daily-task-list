import { createClient } from "@supabase/supabase-js";
// Existing project's PUBLIC client configuration; authorization is enforced by RLS.
export const url =
  import.meta.env.VITE_SUPABASE_URL ||
  "https://backend.appmiaoda.com/projects/supabase346075412100595712";
export const anon =
  import.meta.env.VITE_SUPABASE_ANON_KEY ||
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJhdWQiOiJhdXRoZW50aWNhdGVkIiwiZXhwIjoyMTAxOTM4MDA4LCJpc3MiOiJzdXBhYmFzZSIsInJvbGUiOiJhbm9uIiwic3ViIjoiYW5vbiJ9.--elxnX4M48RZHFD7-2kknktuLmmhl0xCUiBKuSxtoo";
export const supabase = createClient(url, anon);
