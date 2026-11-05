// app/api/account/route.ts
// PATCH  { password }           -> change password (requires a fresh session)
// DELETE { confirm: "DELETE" }  -> permanently delete the account (lib/account.ts;
//   the admin panel uses the same function).

import { NextResponse } from "next/server";
import { requireUser } from "@/lib/supabase-server";
import { AccountBusyError, SubscriptionCancelError, deleteAccount } from "@/lib/account";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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

  try {
    await deleteAccount(user.id);
    return NextResponse.json({ success: true });
  } catch (err) {
    if (err instanceof AccountBusyError) return NextResponse.json({ success: false, error: err.message }, { status: 409 });
    if (err instanceof SubscriptionCancelError) return NextResponse.json({ success: false, error: err.message }, { status: 502 });
    console.error(`[account] delete failed for ${user.id}:`, err);
    return NextResponse.json(
      { success: false, error: "Could not delete the account. Please contact support." },
      { status: 500 }
    );
  }
}
