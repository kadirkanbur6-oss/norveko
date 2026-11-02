// lib/teams.ts
// Team seats (2 Nov 2026): an owner invites people with a link; members make
// videos with their own login and projects, but every credit comes from (and
// every refund goes back to) the owner's balance — one shared pool.
//
// Tables (SQL in supabase/README.md): teams (one per owner), team_members
// (a user is in at most one team), team_invites (hashed one-time tokens).

import "server-only";
import { createHash, randomBytes } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

export const MAX_TEAM_MEMBERS = 10;
export const INVITE_DAYS = 7;

export const hashInvite = (token: string) => createHash("sha256").update(token).digest("hex");

/** The team owner whose credits this user spends (the user themself when not a member). */
export async function payerFor(db: SupabaseClient, userId: string): Promise<string> {
  const { data, error } = await db.from("team_members").select("teams(owner_id)").eq("user_id", userId).maybeSingle();
  if (error) return userId; // tables missing or transient: bill the user themself
  const owner = (data?.teams as { owner_id?: string } | null)?.owner_id;
  return owner ?? userId;
}

export interface TeamView {
  role: "owner" | "member";
  team: { id: string; name: string; ownerId: string };
  members: Array<{ userId: string; email: string | null; joinedAt: string; you: boolean }>;
  invites: Array<{ id: string; createdAt: string; expiresAt: string }>;
}

/** The user's team as they see it (null when in none). */
export async function teamFor(db: SupabaseClient, userId: string): Promise<TeamView | null> {
  const { data: owned } = await db.from("teams").select("id, name, owner_id").eq("owner_id", userId).maybeSingle();
  let team = owned as { id: string; name: string; owner_id: string } | null;
  let role: "owner" | "member" = "owner";
  if (!team) {
    const { data: m } = await db.from("team_members").select("team_id").eq("user_id", userId).maybeSingle();
    if (!m) return null;
    const { data: t } = await db.from("teams").select("id, name, owner_id").eq("id", m.team_id).maybeSingle();
    team = t as typeof team;
    role = "member";
  }
  if (!team) return null;
  const { data: rows } = await db.from("team_members").select("user_id, joined_at").eq("team_id", team.id).order("joined_at");
  const members = await Promise.all(
    (rows ?? []).map(async (r) => {
      const { data: u } = await db.auth.admin.getUserById(r.user_id as string);
      return { userId: r.user_id as string, email: u?.user?.email ?? null, joinedAt: r.joined_at as string, you: r.user_id === userId };
    })
  );
  const { data: invites } =
    role === "owner"
      ? await db
          .from("team_invites")
          .select("id, created_at, expires_at")
          .eq("team_id", team.id)
          .is("accepted_at", null)
          .gt("expires_at", new Date().toISOString())
          .order("created_at")
      : { data: [] };
  return {
    role,
    team: { id: team.id, name: team.name, ownerId: team.owner_id },
    members,
    invites: (invites ?? []).map((i) => ({ id: i.id as string, createdAt: i.created_at as string, expiresAt: i.expires_at as string })),
  };
}

export function newInvite(): { token: string; hash: string; expiresAt: string } {
  const token = randomBytes(24).toString("base64url");
  return { token, hash: hashInvite(token), expiresAt: new Date(Date.now() + INVITE_DAYS * 86400_000).toISOString() };
}
