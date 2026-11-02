// app/api/team/route.ts — team seats (lib/teams.ts).
//   GET → your team (owner or member view)
//   POST {action}: create {name} · rename {name} · invite · revokeInvite {id} · remove {userId} · leave · delete

import { NextResponse } from "next/server";
import { requireUser } from "@/lib/supabase-server";
import { adminDb, apiAllowed } from "@/lib/api-keys";
import { MAX_TEAM_MEMBERS, newInvite, teamFor } from "@/lib/teams";
import { siteUrl } from "@/lib/youtube/oauth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bad = (error: string, status = 400) => NextResponse.json({ success: false, error }, { status });

export async function GET() {
  const { user } = await requireUser();
  if (!user) return bad("Not authenticated", 401);
  const db = adminDb();
  const team = await teamFor(db, user.id).catch(() => null);
  const canCreate = !team && (await apiAllowed(db, user.id).catch(() => false));
  return NextResponse.json({ success: true, team, canCreate, maxMembers: MAX_TEAM_MEMBERS });
}

export async function POST(req: Request) {
  const { user } = await requireUser();
  if (!user) return bad("Not authenticated", 401);
  const db = adminDb();
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const name = typeof body.name === "string" ? body.name.trim().slice(0, 50) : "";
  const team = await teamFor(db, user.id).catch(() => null);
  const owner = team?.role === "owner";

  switch (body.action) {
    case "create": {
      if (team) return bad("You're already in a team.");
      if (!(await apiAllowed(db, user.id))) return bad("Teams are available on any plan or pack.", 403);
      const { error } = await db.from("teams").insert({ owner_id: user.id, name: name || "My team" });
      if (error) return bad("Could not create the team.", 500);
      break;
    }
    case "rename": {
      if (!owner) return bad("Only the team owner can do that.", 403);
      if (!name) return bad("Give the team a name.");
      await db.from("teams").update({ name }).eq("id", team!.team.id);
      break;
    }
    case "invite": {
      if (!owner) return bad("Only the team owner can invite people.", 403);
      if (team!.members.length + team!.invites.length >= MAX_TEAM_MEMBERS) {
        return bad(`A team can have up to ${MAX_TEAM_MEMBERS} members (open invites count too).`);
      }
      const invite = newInvite();
      const { error } = await db.from("team_invites").insert({ team_id: team!.team.id, token_hash: invite.hash, expires_at: invite.expiresAt });
      if (error) return bad("Could not create the invite.", 500);
      return NextResponse.json({ success: true, link: `${siteUrl()}/team/join?token=${invite.token}`, team: await teamFor(db, user.id) });
    }
    case "revokeInvite": {
      if (!owner) return bad("Only the team owner can do that.", 403);
      await db.from("team_invites").delete().eq("id", String(body.id ?? "")).eq("team_id", team!.team.id);
      break;
    }
    case "remove": {
      if (!owner) return bad("Only the team owner can remove members.", 403);
      await db.from("team_members").delete().eq("team_id", team!.team.id).eq("user_id", String(body.userId ?? ""));
      break;
    }
    case "leave": {
      if (!team || owner) return bad(owner ? "Owners delete the team instead of leaving it." : "You're not in a team.");
      await db.from("team_members").delete().eq("user_id", user.id);
      break;
    }
    case "delete": {
      if (!owner) return bad("Only the team owner can delete the team.", 403);
      await db.from("team_members").delete().eq("team_id", team!.team.id);
      await db.from("team_invites").delete().eq("team_id", team!.team.id);
      await db.from("teams").delete().eq("id", team!.team.id);
      break;
    }
    default:
      return bad("Unknown action.");
  }
  return NextResponse.json({ success: true, team: await teamFor(db, user.id).catch(() => null) });
}
