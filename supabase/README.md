# Supabase notes

The database schema is managed in the Supabase dashboard; this folder only
documents assumptions the application code makes.

## Paddle refunds (`app/api/webhooks/paddle/route.ts`)

A refund approved in Paddle calls `add_credits` with a **negative** amount to
take the purchased credits back. Make sure the function allows that:

- `add_credits(p_user_id uuid, p_amount int, p_type text, p_reason text)` must
  not reject `p_amount < 0`.
- `user_credits.credits` must not have a `CHECK (credits >= 0)` constraint, or
  the refund will fail when the user already spent the credits. A negative
  balance after a refund is intended.
- `credit_purchases.status` must accept the value `refunded` in addition to
  `completed` (drop or extend any CHECK constraint on that column).

Run in the SQL editor to verify quickly:

```sql
select pg_get_functiondef('public.add_credits'::regproc);
select conname, pg_get_constraintdef(oid)
from pg_constraint
where conrelid in ('public.user_credits'::regclass, 'public.credit_purchases'::regclass);
```

## Paddle webhook events to enable

In the Paddle dashboard → Developer tools → Notifications, point the
destination at `https://norveko.app/api/webhooks/paddle` and subscribe to:

- `transaction.completed`
- `adjustment.created`
- `adjustment.updated`

## Video clips (Kling) — `lib/pipeline/kling.ts`

- Create a **public** Storage bucket named `videos`. Clips are written to
  `videos/<user_id>/<job_id>/scene-<n>.mp4` by the service role.
- No schema change is needed: clip state lives in `pipeline_jobs.steps.video`
  and finished URLs are merged into `projects.content.scenes[].videoUrl`.
- The feature is off until `VIDEO_GENERATION_ENABLED=true` (or the user id is
  in `VIDEO_BETA_USER_IDS`); the API rejects video requests before charging.

## Job options column (orientation + template)

`app/api/pipeline/start` stores the user's UI choices on the job:

```sql
alter table public.pipeline_jobs
  add column if not exists options jsonb not null default '{}'::jsonb;
```

Without the column the insert fails with "column options does not exist".

## Provider cost log — `provider_usage` (`lib/pipeline/usage.ts`)

Every OpenAI / ElevenLabs / Gemini / Kling call made by the pipeline worker
is logged here with the units it consumed and an estimated USD cost, so a
job's real cost can be compared with the credits charged for it. Written by
the service role only; users never read it.

```sql
create table if not exists public.provider_usage (
  id                 bigint generated always as identity primary key,
  created_at         timestamptz not null default now(),
  job_id             uuid not null references public.pipeline_jobs(id) on delete cascade,
  user_id            uuid not null,
  step               text not null,                  -- script | voiceover | thumbnail | video
  provider           text not null,                  -- openai | elevenlabs | gemini | kling
  model              text not null,
  unit               text not null,                  -- tokens | characters | images | seconds
  quantity           integer not null default 0,
  input_tokens       integer,
  output_tokens      integer,
  estimated_cost_usd numeric(12,6) not null default 0,
  duration_ms        integer not null default 0,
  status             text not null check (status in ('ok','failed')),
  error              text
);

create index if not exists provider_usage_job_idx     on public.provider_usage (job_id);
create index if not exists provider_usage_user_idx    on public.provider_usage (user_id, created_at desc);
create index if not exists provider_usage_created_idx on public.provider_usage (created_at desc);

-- RLS on, no policies: only the service role can read or write.
alter table public.provider_usage enable row level security;
```

Useful queries (SQL editor):

```sql
-- Cost vs credits per job (last 7 days)
select j.id, j.created_at, j.credits_charged,
       sum(u.estimated_cost_usd) as est_cost_usd,
       count(*) filter (where u.status = 'failed') as failed_calls
from public.pipeline_jobs j
join public.provider_usage u on u.job_id = j.id
where j.created_at > now() - interval '7 days'
group by j.id order by j.created_at desc;

-- Daily spend per provider
select date_trunc('day', created_at) as day, provider,
       sum(quantity) as units, sum(estimated_cost_usd) as est_cost_usd
from public.provider_usage
group by 1, 2 order by 1 desc, 2;
```

Prices live in `PRICE_LIST` (`lib/pipeline/usage.ts`); override without a
deploy via the `PROVIDER_PRICE_OVERRIDES` env var (JSON, same keys).

## One-off repair — jobs stuck in "running" with a failed step (2026-10-25)

Before commit `fix refund guard`, `failJob()` filtered on `credits_refunded IS NULL`
while the column defaults to `0`, so failed jobs never flipped to `failed` and
never refunded. Run once to repair any such rows and refund the user:

```sql
do $$
declare j record;
begin
  for j in
    select id, user_id, credits_charged
    from public.pipeline_jobs
    where status = 'running'
      and coalesce(credits_refunded, 0) = 0
      and (steps->'script'->>'status' = 'failed'
        or steps->'voiceover'->>'status' = 'failed'
        or steps->'thumbnail'->>'status' = 'failed'
        or steps->'video'->>'status' = 'failed')
  loop
    update public.pipeline_jobs
       set status = 'failed',
           error = coalesce(steps->'voiceover'->>'error', steps->'script'->>'error',
                            steps->'thumbnail'->>'error', steps->'video'->>'error'),
           credits_refunded = j.credits_charged
     where id = j.id;
    perform public.add_credits(j.user_id, j.credits_charged::int, 'refund',
      'Refund: pipeline job failed (manual repair after refund-guard fix)');
  end loop;
end $$;

select id, status, credits_charged, credits_refunded
from public.pipeline_jobs order by created_at desc limit 5;
```

## YouTube publishing (`youtube_connections`, 31 Oct 2026)

One row per user who connected a channel for direct uploads. Only the service
role reads/writes it (RLS on, no policies) — the refresh token is AES-256-GCM
encrypted by the app (`lib/youtube/oauth.ts`).

```sql
create table if not exists public.youtube_connections (
  user_id uuid primary key references auth.users(id) on delete cascade,
  channel_id text not null,
  channel_title text,
  channel_thumbnail text,
  refresh_token_enc text not null,
  scope text,
  created_at timestamptz not null default now()
);
alter table public.youtube_connections enable row level security;
```

## TikTok posting (`tiktok_connections`, 31 Oct 2026)

```sql
create table if not exists public.tiktok_connections (
  user_id uuid primary key references auth.users(id) on delete cascade,
  open_id text not null,
  display_name text,
  avatar_url text,
  refresh_token_enc text not null,
  scope text,
  created_at timestamptz not null default now()
);
alter table public.tiktok_connections enable row level security;
```

## Brand kit (`brand_kits`, 31 Oct 2026)

Written only by `/api/brand` (service role). Logos: `videos/brand/<user>/logo-<uuid>.png`.

```sql
create table if not exists public.brand_kits (
  user_id uuid primary key references auth.users(id) on delete cascade,
  logo_url text,
  logo_path text,
  color text,
  outro_text text,
  logo_on_video boolean not null default true,
  logo_on_thumbnail boolean not null default true,
  updated_at timestamptz not null default now()
);
alter table public.brand_kits enable row level security;
```

## Cloned voices (`voice_clones`, 31 Oct 2026)

One per user, written only by `/api/voices/clone` (service role). The voice itself lives in the
shared ElevenLabs account (name `Norveko · <name> · <user8>`); only its owner may list or use it.

```sql
create table if not exists public.voice_clones (
  user_id uuid primary key references auth.users(id) on delete cascade,
  voice_id text not null unique,
  name text not null,
  created_at timestamptz not null default now()
);
alter table public.voice_clones enable row level security;
```

## Invite & earn (`referral_codes`, `referrals`, `referral_rewards`, 31 Oct 2026)

Service role only (`lib/referrals/referrals.ts`). Inviter earns 20% of the credits of every pack the
invited account buys in its first 12 months; `referral_rewards` is keyed by the Paddle transaction
(idempotent) and flips to `refunded` when Paddle refunds it. Credit type `referral`.

```sql
create table if not exists public.referral_codes (
  user_id uuid primary key references auth.users(id) on delete cascade,
  code text not null unique,
  created_at timestamptz not null default now()
);
create table if not exists public.referrals (
  referred_user_id uuid primary key references auth.users(id) on delete cascade,
  referrer_user_id uuid not null references auth.users(id) on delete cascade,
  code text not null,
  created_at timestamptz not null default now()
);
create index if not exists referrals_referrer_idx on public.referrals (referrer_user_id);
create table if not exists public.referral_rewards (
  paddle_transaction_id text primary key,
  referrer_user_id uuid not null references auth.users(id) on delete cascade,
  referred_user_id uuid not null,
  credits int not null,
  status text not null default 'earned',
  created_at timestamptz not null default now()
);
create index if not exists referral_rewards_referrer_idx on public.referral_rewards (referrer_user_id);
alter table public.referral_codes enable row level security;
alter table public.referrals enable row level security;
alter table public.referral_rewards enable row level security;
```

## Subscriptions (`subscriptions`, `subscription_grants`, 1 Nov 2026)

Service role only (`lib/subscriptions-server.ts`, Paddle webhook). Every paid subscription transaction is
also a `credit_purchases` row (refunds, watermark removal and referral rewards reuse it). Yearly plans
grant monthly from the hourly heartbeat (`/api/series/tick`).

```sql
create table if not exists public.subscriptions (
  paddle_subscription_id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  plan_id text not null,
  status text not null,
  customer_id text,
  current_period_end timestamptz,
  cancel_at timestamptz,
  next_grant_at timestamptz,
  year_grants_left int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists subscriptions_user_idx on public.subscriptions (user_id);
create index if not exists subscriptions_grant_idx on public.subscriptions (next_grant_at) where year_grants_left > 0;
create table if not exists public.subscription_grants (
  grant_key text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  paddle_subscription_id text not null,
  credits int not null,
  created_at timestamptz not null default now()
);
alter table public.subscriptions enable row level security;
alter table public.subscription_grants enable row level security;
```

## Series autopilot (`series`, `series_episodes`, 31 Oct 2026)

```sql
create table if not exists public.series (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  topic text not null,
  settings jsonb not null,
  days int[] not null,
  post_time text not null,
  timezone text not null,
  publish jsonb not null default '{}'::jsonb,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists series_user_idx on public.series(user_id);
create index if not exists series_active_idx on public.series(active);
alter table public.series enable row level security;

create table if not exists public.series_episodes (
  id uuid primary key default gen_random_uuid(),
  series_id uuid not null references public.series(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  scheduled_for timestamptz not null,
  idea text,
  job_id uuid,
  project_id uuid,
  status text not null default 'pending',
  error text,
  publish jsonb,
  created_at timestamptz not null default now(),
  unique (series_id, scheduled_for)
);
create index if not exists series_episodes_job_idx on public.series_episodes(job_id);
alter table public.series_episodes enable row level security;
```

## Heartbeat (pg_cron → Vercel, 31 Oct 2026)

Vercel Hobby crons run once a day, and a function that keeps calling its own
URL is cut off with `508 INFINITE_LOOP_DETECTED` after a few hops. Unattended
jobs (series episodes, closed tabs) therefore get a heartbeat from Supabase:
every minute `/api/pipeline/reap` (reconcile running jobs: poll async steps,
re-kick forgotten steps) and hourly `/api/series/tick?lookahead=2`.
`HEARTBEAT_SECRET` must match the Vercel env var of the same name.

The secret lives in **Supabase Vault** (Integrations → Vault → secret named
`heartbeat_secret`, same value as Vercel `HEARTBEAT_SECRET`) so it never appears
in SQL. (31 Oct: pasting the secret into the SQL broke the quoting twice.)

```sql
create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.schedule('norveko-heartbeat', '* * * * *', $job$
  select net.http_get(
    url := 'https://norveko.app/api/pipeline/reap',
    headers := jsonb_build_object('Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'heartbeat_secret' limit 1)),
    timeout_milliseconds := 5000
  );
$job$);

select cron.schedule('norveko-series-tick', '5 * * * *', $job$
  select net.http_get(
    url := 'https://norveko.app/api/series/tick?lookahead=2',
    headers := jsonb_build_object('Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'heartbeat_secret' limit 1)),
    timeout_milliseconds := 5000
  );
$job$);
-- check: select created, status_code, left(content,100) from net._http_response order by created desc limit 5;
```
