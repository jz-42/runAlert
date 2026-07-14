# Supabase setup

runAlert v1 uses only server-side access to Supabase. Apply the migrations in
`supabase/migrations` to a clean project, then configure the web service with:

- `RUNALERT_CONFIG_STORE=supabase`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `RUNALERT_CREDENTIAL_PEPPER` (at least 32 random bytes, kept server-only)

The browser and desktop app never receive the Supabase key. Row-level security
is enabled without client policies; the Render service performs validated,
credential-scoped operations with the service role.

The v1 schema intentionally does not migrate beta token files or the legacy
`runalert_configs` table.
