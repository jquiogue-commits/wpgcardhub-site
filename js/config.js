// Same public Supabase project the iOS app talks to. The anon key is safe to
// ship client-side — Row Level Security in Postgres is what actually gates
// writes (see CardShowFinder/Data/SupabaseConfig.swift for the app's copy).
const SUPABASE_URL = "https://bcykuylbbgzrclxyqaqu.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJjeWt1eWxiYmd6cmNseHlxYXF1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODIxNzc4NjUsImV4cCI6MjA5Nzc1Mzg2NX0.Fde887gLV04gRiUCRwQIqxF8gC4cHVEDknUnQ0kl0KI";
