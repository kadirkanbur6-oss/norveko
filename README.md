# Norveko

AI content production workspace for video creators. One idea in → script, scene
plan, video prompts, thumbnail, SEO metadata, optional voiceover and (soon)
AI-generated clips out.

Live: https://norveko.app · Stack: Next.js (App Router) · Supabase · Vercel ·
OpenAI · ElevenLabs · Gemini · Kling · Paddle

## Run locally

```bash
npm install
cp .env.example .env.local   # fill in the keys you have
npm run dev                  # http://localhost:3000
```

Checks before pushing:

```bash
npx tsc --noEmit        # types
npm run lint            # eslint
npm run test:pipeline   # pipeline runner tests (no network needed)
```

Pushing to `main` deploys to production on Vercel.

## How a generation runs

1. `POST /api/pipeline/start` validates the request, checks the feature gates,
   charges credits and inserts a `pipeline_jobs` row. It returns immediately.
2. `POST /api/pipeline/run` (internal, secret-protected) executes **one step**
   per invocation — `script` → `voiceover`? → `thumbnail` → `video`? — and
   kicks itself for the next one, so no step is bound by another's timeout.
3. The UI polls `GET /api/pipeline/[id]`; that endpoint also heals the job
   (times out dead steps with a refund, re-kicks steps nobody picked up, polls
   in-flight video tasks). `GET /api/pipeline/reap` does the same for every
   running job from a daily cron.
4. On completion the package is saved as a project.

Credit costs live in one place: `lib/pipeline/steps.ts`. The runner logic is in
`lib/pipeline/runner.ts` and is covered by `lib/pipeline/runner.test.ts`.

## Feature gates (env)

| Variable | Effect |
| --- | --- |
| `GENERATION_ENABLED=false` | Launch lock: nobody can generate except `BETA_USER_IDS`. Rejected before any credit is charged. |
| `VIDEO_GENERATION_ENABLED=true` | Opens Kling video clips to everyone; otherwise only `VIDEO_BETA_USER_IDS`. |

## Payments

Paddle overlay checkout (`app/billing`) → webhook (`app/api/webhooks/paddle`)
grants credits idempotently; approved refunds revoke them. See
`supabase/README.md` for the database assumptions and which Paddle events to
subscribe to. Set `LEGAL_NAME` in `app/lib/legal.ts` before applying for a
Paddle live account.

## Project layout

```
app/                 pages and API routes (App Router)
app/components/      UI components (Sidebar, Header, PipelineProgress, …)
lib/pipeline/        step definitions, providers (openai, elevenlabs,
                     gemini-image, kling), runner, feature gates, tests
lib/packages.ts      credit packages + Paddle price IDs
middleware.ts        route protection (public pages listed at the top)
supabase/README.md   DB/storage assumptions
```

All environment variables are documented in `.env.example`.
