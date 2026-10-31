// app/api/account/route.ts
// PATCH  { password }           -> change password (requires a fresh session)
// DELETE { confirm: "DELETE" }  -> permanently delete the account:
//   storage objects (thumbnails, voiceovers, videos), rows in user tables,
//   then the auth user. Service role is required for the last step.

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireUser } from "@/lib/supabase-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BUCKETS = ["thumbnails", "voiceovers", "videos"] as const;
// Deleted in this order so FK-style dependencies (if any) resolve.
const USER_TABLES = [
  "youtube_connections",
  "tiktok_connections",
  "series",
  "credit_transactions",
  "credit_purchases",
  "pipeline_jobs",
  "projects",
  "channel_videos_cache",
  "channel_stats_snapshots",
  "user_channels",
  "user_credits",
] as const;

function admin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );
}

export async function PATCH(req: Request) {
  const { supabase, user } = await requireUser();
  if (!user) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }

  let body: { password?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ success: false, error: "Invalid request." }, { status: 400 });
  }

  const password = typeof body.password === "string" ? body.password : "";
  if (password.length < 8 || password.length > 128) {
    return NextResponse.json(
      { success: false, error: "Password must be between 8 and 128 characters." },
      { status: 400 }
    );
  }

  const { error } = await supabase.auth.updateUser({ password });
  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 400 });
  }
  return NextResponse.json({ success: true });
}

/** Remove every object under `<prefix>/` in a bucket (handles nested folders). */
async function emptyPrefix(
  client: ReturnType<typeof admin>,
  bucket: string,
  prefix: string
): Promise<void> {
  const { data: entries } = await client.storage.from(bucket).list(prefix, { limit: 1000 });
  if (!entries?.length) return;
  const files: string[] = [];
  for (const entry of entries) {
    // Folders come back without metadata/id.
    if (entry.id === null || (entry as { metadata?: unknown }).metadata == null) {
      await emptyPrefix(client, bucket, `${prefix}/${entry.name}`);
    } else {
      files.push(`${prefix}/${entry.name}`);
    }
  }
  if (files.length) await client.storage.from(bucket).remove(files);
}

export async function DELETE(req: Request) {
  const { user } = await requireUser();
  if (!user) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }

  let body: { confirm?: unknown };
  try {
    body = await req.json();
  } catch {
    body = {};
  }
  if (body.confirm !== "DELETE") {
    return NextResponse.json(
      { success: false, error: 'Type DELETE to confirm.' },
      { status: 400 }
    );
  }

  const client = admin();

  // Refuse while a generation is running so we don't orphan a worker.
  const { count: running } = await client
    .from("pipeline_jobs")
    .select("id", { count: "exact", head: true })
    .eq("user_id", user.id)
    .eq("status", "running");
  if ((running ?? 0) > 0) {
    return NextResponse.json(
      { success: false, error: "A generation is still running. Please wait for it to finish, then try again." },
      { status: 409 }
    );
  }

  try {
    for (const bucket of BUCKETS) {
      try {
        await emptyPrefix(client, bucket, user.id);
      } catch (err) {
        console.error(`[account] storage cleanup ${bucket} failed:`, err);
      }
    }
    // Legacy thumbnails were stored at the bucket root as <jobId>.png; collect them by job id.
    const { data: jobs } = await client
      .from("pipeline_jobs")
      .select("id")
      .eq("user_id", user.id);
    const legacy = (jobs ?? []).flatMap((j) => [`${j.id}.png`, `${j.id}.jpg`]);
    if (legacy.length) {
      await client.storage.from("thumbnails").remove(legacy);
    }

    // Revoke the YouTube upload grant at Google before the row disappears.
    try {
      const { getConnection, decryptToken, revokeToken } = await import("@/lib/youtube/oauth");
      const yt = await getConnection(client, user.id);
      if (yt) await revokeToken(decryptToken(yt.refresh_token_enc));
    } catch {
      // table missing or already revoked
    }

    try {
      const { tiktokAccessToken, revokeTikTok } = await import("@/lib/tiktok/client");
      const tt = await tiktokAccessToken(client, user.id);
      if (tt) await revokeTikTok(tt.token);
    } catch {
      // table missing or already revoked
    }

    for (const table of USER_TABLES) {
      const { error } = await client.from(table).delete().eq("user_id", user.id);
      if (error && !/does not exist/i.test(error.message)) {
        throw new Error(`${table}: ${error.message}`);
      }
    }

    const { error: authError } = await client.auth.admin.deleteUser(user.id);
    if (authError) throw new Error(authError.message);

    console.log(`[account] deleted user ${user.id}`);
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error(`[account] delete failed for ${user.id}:`, err);
    return NextResponse.json(
      { success: false, error: "Could not delete the account. Please contact support." },
      { status: 500 }
    );
  }
}
