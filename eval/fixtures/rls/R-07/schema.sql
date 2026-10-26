CREATE TABLE public.profiles (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id),
  display_name text NOT NULL CHECK (length(display_name) BETWEEN 1 AND 80),
  private_note text NOT NULL
);
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
GRANT USAGE ON SCHEMA public TO authenticated, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.profiles TO authenticated, anon;

CREATE POLICY profiles_select ON public.profiles
  FOR SELECT TO authenticated USING (true);
CREATE POLICY profiles_insert ON public.profiles
  FOR INSERT TO authenticated
  WITH CHECK ((SELECT auth.uid()) = user_id);
CREATE POLICY profiles_update ON public.profiles
  FOR UPDATE TO authenticated
  USING ((SELECT auth.uid()) = user_id)
  WITH CHECK ((SELECT auth.uid()) = user_id);
CREATE POLICY profiles_delete ON public.profiles
  FOR DELETE TO authenticated
  USING (true);

CREATE TABLE public.posts (
  id uuid PRIMARY KEY,
  title text NOT NULL
);
ALTER TABLE public.posts ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.posts TO authenticated, anon;
CREATE POLICY posts_read ON public.posts
  FOR SELECT TO authenticated, anon USING (true);
