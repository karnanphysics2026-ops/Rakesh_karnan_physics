-- Stage 2 fix: user_profiles was relying entirely on a client-side upsert in
-- auth.js at signup time (under RLS, wrapped in Promise.allSettled — failures
-- silently swallowed). profiles has always had a reliable server-side trigger
-- (handle_new_user(), see 001_initial_schema.sql) that guarantees a row on
-- every signup regardless of client JS. This gives user_profiles the same
-- guarantee, so it can become the single canonical profile table.

CREATE OR REPLACE FUNCTION handle_new_user_profile()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.user_profiles (id, display_name)
  VALUES (NEW.id, NEW.raw_user_meta_data->>'display_name')
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS on_auth_user_created_profile ON auth.users;
CREATE TRIGGER on_auth_user_created_profile
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user_profile();

-- Backfill: create user_profiles rows for any existing auth.users missing one
-- (covers the 2 signups dropped by the old client-side-only insert).
INSERT INTO public.user_profiles (id, display_name)
SELECT u.id, u.raw_user_meta_data->>'display_name'
FROM auth.users u
LEFT JOIN public.user_profiles up ON up.id = u.id
WHERE up.id IS NULL
ON CONFLICT (id) DO NOTHING;
