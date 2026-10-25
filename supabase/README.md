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
