import { NextResponse } from "next/server";
import { requireUser } from "@/lib/supabase-server";


// Projeleri listele
export async function GET() {
  try {
    const { supabase, user } = await requireUser();

    if (!user) {
      return NextResponse.json(
        { success: false, error: "Unauthorized" },
        { status: 401 }
      );
    }

    const { data, error } = await supabase
      .from("projects")
      .select("id, title, platform, style, duration, idea, status, created_at, thumbnail:content->>thumbnailUrl, video:content->>finalVideoUrl")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false });

    if (error) {
      throw new Error(error.message);
    }

    return NextResponse.json({ success: true, projects: data ?? [] });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    );
  }
}
