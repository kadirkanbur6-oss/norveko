// app/api/team/join/route.ts — POST {token}: join the team behind an invite link.
import { NextResponse } from "next/server";
import { requireUser } from "@/lib/supabase-server";
import { adminDb } from "@/lib/api-keys";
import { MAX_TEAM_MEMBERS, hashInvite } from "@/lib/teams";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bad = (error: string, status = 400) => NextResponse.json({ success: false, error }, { status });

export async function POST(req: Request) {
  const { user } = await requireUser();
  if (!user) return bad("Sign in first, then open the invite link again.", 401);
  const body = (await req.json().catch(() => ({}))) as { token?: unknown };
  const token = typeof body.token === "string" ? body.token.trim() : "";
  if (!/^[A-Za-z0-9_-]{20,}$/.test(token)) return bad("This invite link isn't valid.");
  const db = adminDb();
  const { data: invite } = await db
    .from("team_invites")
    .select("id, team_id, expires_at, accepted_at")
    .eq("token_hash", hashInvite(token))
    .maybeSingle();
  if (!invite || invite.accepted_at || Date.parse(invite.expires_at as string) < Date.now()) {
    return bad("This invite link has expired or was already used. Ask for a new one.");
  }
  const { data: team } = await db.from("teams").select("id, name, owner_id").eq("id", invite.team_id).maybeSingle();
  if (!team) return bad("That team no longer exists.");
  if (team.owner_id === user.id) return bad("That's your own team.");
  const [{ data: ownsTeam }, { data: member }] = await Promise.all([
    db.from("teams").select("id").eq("owner_id", user.id).maybeSingle(),
    db.from("team_members").select("team_id").eq("user_id", user.id).maybeSingle(),
  ]);
  if (ownsTeam) return bad("You own a team. Delete it first to join another one.");
  if (member) return bad("You're already in a team. Leave it first to join this one.");
  const { count } = await db.from("team_members").select("user_id", { count: "exact", head: true }).eq("team_id", team.id);
  if ((count ?? 0) >= MAX_TEAM_MEMBERS) return bad("This team is full.");

  const { error } = await db.from("team_members").insert({ team_id: team.id, user_id: user.id });
  if (error) return bad("Could not join the team. Please try again.", 500);
  await db.from("team_invites").update({ accepted_at: new Date().toISOString(), accepted_by: user.id }).eq("id", invite.id);
  return NextResponse.json({ success: true, team: { name: team.name } });
}
