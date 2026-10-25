import { NextResponse } from "next/server";
import { requireUser } from "@/lib/supabase-server";


// Ayarları getir: profil + bağlı kanal
export async function GET() {
  try {
    const { supabase, user } = await requireUser();

    if (!user) {
      return NextResponse.json(
        { success: false, error: "Unauthorized" },
        { status: 401 }
      );
    }

    const { data: channelData } = await supabase
      .from("user_channels")
      .select("channel_id")
      .eq("user_id", user.id)
      .maybeSingle();

    return NextResponse.json({
      success: true,
      settings: {
        email: user.email ?? "",
        createdAt: user.created_at ?? null,
        channelId: channelData?.channel_id ?? null,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    );
  }
}

// Kanal ID güncelle
export async function PATCH(request: Request) {
  try {
    const { supabase, user } = await requireUser();

    if (!user) {
      return NextResponse.json(
        { success: false, error: "Unauthorized" },
        { status: 401 }
      );
    }

    const body = await request.json();
    const channelId = (body.channelId ?? "").trim();

    if (!channelId.startsWith("UC") || channelId.length < 20) {
      return NextResponse.json(
        {
          success: false,
          error:
            "Invalid channel ID. YouTube channel IDs start with 'UC' (e.g. UCxxxxxxxxxxxxxxxxxxxxxx).",
        },
        { status: 400 }
      );
    }

    // Kayıt varsa güncelle, yoksa oluştur
    const { data: existing } = await supabase
      .from("user_channels")
      .select("id")
      .eq("user_id", user.id)
      .maybeSingle();

    if (existing) {
      const { error } = await supabase
        .from("user_channels")
        .update({ channel_id: channelId })
        .eq("user_id", user.id);

      if (error) throw new Error(error.message);
    } else {
      const { error } = await supabase.from("user_channels").insert({
        user_id: user.id,
        channel_id: channelId,
      });

      if (error) throw new Error(error.message);
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    );
  }
}