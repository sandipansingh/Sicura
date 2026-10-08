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
