/** Trusted bootstrap only. Credentials are supplied as parameterized values separately. */
export const BOOTSTRAP = `
CREATE ROLE schema_loader NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
CREATE ROLE authenticated NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
CREATE ROLE anon NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
CREATE ROLE verifier_login LOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
GRANT authenticated, anon TO verifier_login WITH INHERIT FALSE, SET TRUE;
REVOKE ALL ON DATABASE postgres FROM PUBLIC;
GRANT CONNECT ON DATABASE postgres TO verifier_login;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
ALTER SCHEMA public OWNER TO schema_loader;
CREATE SCHEMA auth;
CREATE TABLE auth.users (id uuid PRIMARY KEY);
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE SECURITY INVOKER SET search_path=pg_catalog AS $$
 SELECT NULLIF(COALESCE(NULLIF(current_setting('request.jwt.claims',true),''),'{}')::jsonb->>'sub','')::uuid
$$;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE SECURITY INVOKER SET search_path=pg_catalog AS $$
 SELECT COALESCE(NULLIF(current_setting('request.jwt.claims',true),''),'{}')::jsonb->>'role'
$$;
CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path=pg_catalog AS $$
 SELECT COALESCE(NULLIF(current_setting('request.jwt.claims',true),''),'{}')::jsonb
$$;
GRANT USAGE ON SCHEMA auth TO schema_loader, authenticated, anon;
GRANT REFERENCES ON auth.users TO schema_loader;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA auth TO schema_loader, authenticated, anon;
GRANT CREATE ON DATABASE postgres TO schema_loader;
`;

/** Database compatibility only; no production auth, HTTP services or Storage API. */
export const SUPABASE_BOOTSTRAP = `
CREATE ROLE service_role NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
CREATE ROLE harness_seed NOLOGIN NOSUPERUSER BYPASSRLS NOCREATEDB NOCREATEROLE;
CREATE ROLE schema_loader_login LOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
GRANT schema_loader TO schema_loader_login WITH INHERIT FALSE, SET TRUE;
GRANT CONNECT ON DATABASE postgres TO schema_loader_login;
ALTER TABLE auth.users OWNER TO schema_loader;
ALTER TABLE auth.users ADD COLUMN email text, ADD COLUMN raw_user_meta_data jsonb DEFAULT '{}',
 ADD COLUMN raw_app_meta_data jsonb DEFAULT '{}', ADD COLUMN created_at timestamptz DEFAULT now(),
 ADD COLUMN updated_at timestamptz DEFAULT now(), ADD COLUMN aud text, ADD COLUMN role text;
CREATE SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA extensions;
GRANT USAGE ON SCHEMA extensions TO schema_loader, authenticated, anon;
CREATE SCHEMA storage AUTHORIZATION schema_loader;
CREATE TABLE storage.buckets(id text PRIMARY KEY, name text NOT NULL, owner uuid,
 public boolean DEFAULT false, file_size_limit bigint, allowed_mime_types text[],
 created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now());
CREATE TABLE storage.objects(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), bucket_id text REFERENCES storage.buckets(id),
 name text, owner uuid, owner_id text, metadata jsonb, created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now());
ALTER TABLE storage.buckets OWNER TO schema_loader;
ALTER TABLE storage.objects OWNER TO schema_loader;
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
CREATE FUNCTION storage.foldername(name text) RETURNS text[] LANGUAGE sql IMMUTABLE SECURITY INVOKER
 SET search_path=pg_catalog AS $$ SELECT (string_to_array(name,'/'))[1:array_length(string_to_array(name,'/'),1)-1] $$;
GRANT USAGE ON SCHEMA storage TO authenticated, anon;
GRANT ALL ON storage.objects, storage.buckets TO authenticated, anon;
CREATE SCHEMA supabase_migrations;
CREATE TABLE supabase_migrations.schema_migrations(version text PRIMARY KEY, statements text[], name text);
GRANT USAGE ON SCHEMA supabase_migrations TO schema_loader;
GRANT SELECT ON supabase_migrations.schema_migrations TO schema_loader;
GRANT USAGE ON SCHEMA auth TO harness_seed;
GRANT ALL ON auth.users TO harness_seed;
`;
