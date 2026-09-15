begin;

create table public.radar_jobs (
  id uuid primary key default gen_random_uuid(),
  repository text not null,
  sha text not null check (sha ~ '^[a-f0-9]{40}$'),
  state text not null default 'queued' check (state in ('queued', 'processing', 'complete', 'failed')),
  attempts integer not null default 0,
  created_at timestamptz not null default now(),
  available_at timestamptz not null default now(),
  lease_until timestamptz,
  claim_id uuid,
  completed_at timestamptz,
  partial boolean not null default false,
  error text,
  unique(repository, sha)
);
create index radar_jobs_pending on public.radar_jobs(state, available_at);

create table public.radar_findings (
  id uuid primary key default gen_random_uuid(),
  repository text not null,
  commit_sha text not null,
  path text not null,
  provider text not null,
  provider_name text not null,
  fingerprint text not null check (fingerprint ~ '^[a-f0-9]{64}$'),
  redacted text not null check (redacted ~ '^.{4}•{16}$'),
  line integer not null check (line > 0),
  confidence text not null check (confidence in ('High', 'Medium')),
  status text not null default 'Open' check (status in ('Open', 'Resolved', 'Dismissed')),
  found_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(repository, commit_sha, path, fingerprint)
);
create index radar_findings_recent on public.radar_findings(found_at desc);

create table public.radar_state (id text primary key, data jsonb not null);
create table public.radar_limits (key text primary key, hits integer not null, expires_at timestamptz not null);

alter table public.radar_jobs enable row level security;
alter table public.radar_findings enable row level security;
alter table public.radar_state enable row level security;
alter table public.radar_limits enable row level security;
revoke all on public.radar_jobs, public.radar_findings, public.radar_state, public.radar_limits from public, anon, authenticated;
grant select, insert, update, delete on public.radar_jobs, public.radar_findings, public.radar_state, public.radar_limits to service_role;

create function public.radar_enqueue(p_repository text, p_shas jsonb, p_truncated boolean)
returns integer language plpgsql security invoker set search_path = '' as $$
declare inserted integer;
begin
  insert into public.radar_jobs(repository, sha)
    select p_repository, value from jsonb_array_elements_text(p_shas)
    on conflict (repository, sha) do nothing;
  get diagnostics inserted = row_count;
  insert into public.radar_state values ('webhook', jsonb_build_object('lastEvent', now(), 'repository', p_repository, 'truncated', p_truncated))
    on conflict (id) do update set data = excluded.data;
  return inserted;
end;
$$;

create function public.radar_claim() returns jsonb language plpgsql security invoker set search_path = '' as $$
declare job public.radar_jobs;
begin
  if not pg_try_advisory_xact_lock(749214003) then return null; end if;
  update public.radar_jobs set state = 'failed', error = 'Worker lease expired after maximum attempts'
    where state = 'processing' and lease_until < now() and attempts >= 5;
  if exists(select 1 from public.radar_jobs where state = 'processing' and lease_until >= now()) then return null; end if;
  select * into job from public.radar_jobs
    where attempts < 5 and ((state = 'queued' and available_at <= now()) or (state = 'processing' and lease_until < now()))
    order by created_at for update skip locked limit 1;
  if not found then return null; end if;
  update public.radar_jobs set state = 'processing', attempts = attempts + 1,
    lease_until = now() + interval '15 minutes', claim_id = gen_random_uuid()
    where id = job.id returning * into job;
  return to_jsonb(job);
end;
$$;

create function public.radar_finish(p_id uuid, p_claim uuid, p_findings jsonb, p_partial boolean)
returns boolean language plpgsql security invoker set search_path = '' as $$
declare job public.radar_jobs;
begin
  select * into job from public.radar_jobs where id = p_id and claim_id = p_claim
    and state = 'processing' and lease_until > now() for update;
  if not found then return false; end if;
  insert into public.radar_findings(repository, commit_sha, path, provider, provider_name, fingerprint, redacted, line, confidence)
    select job.repository, job.sha, item->>'path', item->>'provider', item->>'providerName',
      item->>'fingerprint', item->>'redacted', (item->>'line')::integer, item->>'confidence'
      from jsonb_array_elements(p_findings) item
    on conflict (repository, commit_sha, path, fingerprint) do nothing;
  update public.radar_jobs set state = 'complete', completed_at = now(), partial = p_partial, error = null where id = job.id;
  return true;
end;
$$;

create function public.radar_fail(p_id uuid, p_claim uuid, p_error text)
returns void language sql security invoker set search_path = '' as $$
  update public.radar_jobs set state = case when attempts >= 5 then 'failed' else 'queued' end,
    available_at = now() + make_interval(secs => least(3600, (60 * power(2, attempts))::integer)),
    error = left(p_error, 200), lease_until = null
    where id = p_id and claim_id = p_claim and state = 'processing';
$$;

create function public.radar_limit(p_key text, p_seconds integer, p_limit integer)
returns boolean language plpgsql security invoker set search_path = '' as $$
declare count integer;
begin
  delete from public.radar_limits where expires_at < now();
  insert into public.radar_limits values (p_key, 1, now() + make_interval(secs => p_seconds))
    on conflict (key) do update set hits = public.radar_limits.hits + 1 returning hits into count;
  return count <= p_limit;
end;
$$;

create function public.radar_dashboard() returns jsonb language sql stable security invoker set search_path = '' as $$
select jsonb_build_object(
  'findings', coalesce((select jsonb_agg(f order by f."foundAt" desc) from (
    select id as _id, repository, commit_sha as commit, path, provider, provider_name as "providerName", redacted, line,
      confidence, 'High' as severity, status, found_at as "foundAt" from public.radar_findings order by found_at desc limit 200
  ) f), '[]'::jsonb),
  'total', (select count(*) from public.radar_findings),
  'open', (select count(*) from public.radar_findings where status = 'Open'),
  'queued', (select count(*) from public.radar_jobs where state in ('queued', 'processing')),
  'failed', (select count(*) from public.radar_jobs where state = 'failed'),
  'completed', (select count(*) from public.radar_jobs where state = 'complete'),
  'partial', (select count(*) from public.radar_jobs where partial),
  'repositories', coalesce((select jsonb_agg(repository) from (select distinct repository from public.radar_jobs) r), '[]'::jsonb),
  'lastScan', (select max(completed_at) from public.radar_jobs),
  'lastError', (select error from public.radar_jobs where error is not null order by created_at desc limit 1),
  'working', exists(select 1 from public.radar_jobs where state = 'processing' and lease_until > now()),
  'webhook', (select data from public.radar_state where id = 'webhook')
);
$$;

create function public.radar_status(p_id uuid, p_status text) returns boolean language plpgsql security invoker set search_path = '' as $$
begin
  update public.radar_findings set status = p_status, updated_at = now() where id = p_id;
  return found;
end;
$$;

revoke all on function public.radar_enqueue(text, jsonb, boolean), public.radar_claim(), public.radar_finish(uuid, uuid, jsonb, boolean), public.radar_fail(uuid, uuid, text), public.radar_limit(text, integer, integer), public.radar_dashboard(), public.radar_status(uuid, text) from public, anon, authenticated;
grant execute on function public.radar_enqueue(text, jsonb, boolean), public.radar_claim(), public.radar_finish(uuid, uuid, jsonb, boolean), public.radar_fail(uuid, uuid, text), public.radar_limit(text, integer, integer), public.radar_dashboard(), public.radar_status(uuid, text) to service_role;
notify pgrst, 'reload schema';
commit;
