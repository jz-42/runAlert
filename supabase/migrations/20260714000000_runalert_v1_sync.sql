begin;

create table public.runalert_v1_configs (
  account_id uuid primary key,
  schema_version integer not null default 1 check (schema_version = 1),
  revision bigint not null default 1 check (revision >= 1),
  updated_at timestamptz not null default now(),
  config jsonb not null check (jsonb_typeof(config) = 'object')
);

create table public.runalert_v1_device_credentials (
  id uuid primary key,
  account_id uuid not null references public.runalert_v1_configs(account_id) on delete cascade,
  credential_hash text not null unique check (credential_hash ~ '^[a-f0-9]{64}$'),
  device_name text not null check (char_length(device_name) between 1 and 80),
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);

create index runalert_v1_device_credentials_account_idx
  on public.runalert_v1_device_credentials (account_id);

create table public.runalert_v1_pairing_exchanges (
  id uuid primary key,
  account_id uuid not null references public.runalert_v1_configs(account_id) on delete cascade,
  exchange_hash text not null unique check (exchange_hash ~ '^[a-f0-9]{64}$'),
  code_hash text not null unique check (code_hash ~ '^[a-f0-9]{64}$'),
  requested_device_name text not null check (char_length(requested_device_name) between 1 and 80),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  check (expires_at > created_at)
);

create index runalert_v1_pairing_exchanges_account_idx
  on public.runalert_v1_pairing_exchanges (account_id);

create index runalert_v1_pairing_exchanges_expiry_idx
  on public.runalert_v1_pairing_exchanges (expires_at)
  where consumed_at is null;

alter table public.runalert_v1_configs enable row level security;
alter table public.runalert_v1_device_credentials enable row level security;
alter table public.runalert_v1_pairing_exchanges enable row level security;

create or replace function public.runalert_bootstrap_account(
  p_account_id uuid,
  p_schema_version integer,
  p_revision bigint,
  p_updated_at timestamptz,
  p_config jsonb,
  p_device_id uuid,
  p_credential_hash text,
  p_device_name text,
  p_device_created_at timestamptz
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.runalert_v1_configs (
    account_id,
    schema_version,
    revision,
    updated_at,
    config
  ) values (
    p_account_id,
    p_schema_version,
    p_revision,
    p_updated_at,
    p_config
  );

  insert into public.runalert_v1_device_credentials (
    id,
    account_id,
    credential_hash,
    device_name,
    created_at
  ) values (
    p_device_id,
    p_account_id,
    p_credential_hash,
    p_device_name,
    p_device_created_at
  );
end;
$$;

create or replace function public.runalert_update_config(
  p_account_id uuid,
  p_expected_revision bigint,
  p_updated_at timestamptz,
  p_config jsonb
) returns table (
  update_status text,
  schema_version integer,
  revision bigint,
  updated_at timestamptz,
  config jsonb
)
language plpgsql
security definer
set search_path = public
as $$
declare
  current_row public.runalert_v1_configs%rowtype;
begin
  select *
    into current_row
    from public.runalert_v1_configs as stored
   where stored.account_id = p_account_id
   for update;

  if not found then
    return query select 'missing'::text, null::integer, null::bigint,
      null::timestamptz, null::jsonb;
    return;
  end if;

  if current_row.revision <> p_expected_revision then
    return query select 'conflict'::text, current_row.schema_version,
      current_row.revision, current_row.updated_at, current_row.config;
    return;
  end if;

  update public.runalert_v1_configs as stored
     set revision = stored.revision + 1,
         updated_at = p_updated_at,
         config = p_config
   where stored.account_id = p_account_id
   returning stored.* into current_row;

  return query select 'updated'::text, current_row.schema_version,
    current_row.revision, current_row.updated_at, current_row.config;
end;
$$;

create or replace function public.runalert_consume_pairing_exchange(
  p_exchange_hash text,
  p_code_hash text,
  p_consumed_at timestamptz
) returns table (
  consume_status text,
  pairing_id uuid,
  account_id uuid,
  requested_device_name text,
  expires_at timestamptz,
  consumed_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  pairing public.runalert_v1_pairing_exchanges%rowtype;
begin
  select *
    into pairing
    from public.runalert_v1_pairing_exchanges as candidate
   where (p_exchange_hash is not null and candidate.exchange_hash = p_exchange_hash)
      or (p_code_hash is not null and candidate.code_hash = p_code_hash)
   limit 1
   for update;

  if not found then
    return query select 'missing'::text, null::uuid, null::uuid, null::text,
      null::timestamptz, null::timestamptz;
    return;
  end if;

  if pairing.consumed_at is not null then
    return query select 'consumed'::text, pairing.id, pairing.account_id,
      pairing.requested_device_name, pairing.expires_at, pairing.consumed_at;
    return;
  end if;

  if pairing.expires_at <= p_consumed_at then
    return query select 'expired'::text, pairing.id, pairing.account_id,
      pairing.requested_device_name, pairing.expires_at, pairing.consumed_at;
    return;
  end if;

  update public.runalert_v1_pairing_exchanges as stored
     set consumed_at = p_consumed_at
   where stored.id = pairing.id
   returning stored.* into pairing;

  return query select 'consumed-now'::text, pairing.id, pairing.account_id,
    pairing.requested_device_name, pairing.expires_at, pairing.consumed_at;
end;
$$;

create or replace function public.runalert_complete_pairing(
  p_exchange_hash text,
  p_code_hash text,
  p_consumed_at timestamptz,
  p_device_id uuid,
  p_credential_hash text,
  p_device_name text,
  p_device_created_at timestamptz
) returns table (
  consume_status text,
  account_id uuid,
  requested_device_name text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  pairing public.runalert_v1_pairing_exchanges%rowtype;
begin
  select *
    into pairing
    from public.runalert_v1_pairing_exchanges as candidate
   where (p_exchange_hash is not null and candidate.exchange_hash = p_exchange_hash)
      or (p_code_hash is not null and candidate.code_hash = p_code_hash)
   limit 1
   for update;

  if not found then
    return query select 'missing'::text, null::uuid, null::text;
    return;
  end if;
  if pairing.consumed_at is not null then
    return query select 'consumed'::text, pairing.account_id,
      pairing.requested_device_name;
    return;
  end if;
  if pairing.expires_at <= p_consumed_at then
    return query select 'expired'::text, pairing.account_id,
      pairing.requested_device_name;
    return;
  end if;

  update public.runalert_v1_pairing_exchanges as stored
     set consumed_at = p_consumed_at
   where stored.id = pairing.id;

  insert into public.runalert_v1_device_credentials (
    id,
    account_id,
    credential_hash,
    device_name,
    created_at
  ) values (
    p_device_id,
    pairing.account_id,
    p_credential_hash,
    p_device_name,
    p_device_created_at
  );

  return query select 'consumed-now'::text, pairing.account_id,
    pairing.requested_device_name;
end;
$$;

revoke all on table public.runalert_v1_configs from anon, authenticated;
revoke all on table public.runalert_v1_device_credentials from anon, authenticated;
revoke all on table public.runalert_v1_pairing_exchanges from anon, authenticated;
revoke all on function public.runalert_bootstrap_account from public, anon, authenticated;
revoke all on function public.runalert_update_config from public, anon, authenticated;
revoke all on function public.runalert_consume_pairing_exchange from public, anon, authenticated;
revoke all on function public.runalert_complete_pairing from public, anon, authenticated;

grant execute on function public.runalert_bootstrap_account to service_role;
grant execute on function public.runalert_update_config to service_role;
grant execute on function public.runalert_consume_pairing_exchange to service_role;
grant execute on function public.runalert_complete_pairing to service_role;

commit;
