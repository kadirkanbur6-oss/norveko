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
