import { createClient } from "@supabase/supabase-js";
// Personal Supabase project's PUBLIC client configuration; authorization is enforced by RLS.
export const url =
  import.meta.env.VITE_SUPABASE_URL ||
  "https://dzztdkablskhwcanhnid.supabase.co";
export const anon =
  import.meta.env.VITE_SUPABASE_ANON_KEY ||
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImR6enRka2FibHNraHdjYW5obmlkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODk0NDIyODksImV4cCI6MjEwNTAxODI4OX0.E77mYRMElEds31Cs47_sXFelVXDkhu4PK9D1Qtt05nA";
export const supabase = createClient(url, anon);
