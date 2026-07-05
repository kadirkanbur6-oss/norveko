import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL as string;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY as string;

async function getSupabaseWithSession() {
  const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll: async () => {
        const requestCookies = await cookies();
        return requestCookies.getAll().map((cookie) => ({
          name: cookie.name,
          value: cookie.value,
        }));
      },
    },
  });

  const {
    data: { session },
  } = await supabase.auth.getSession();

  return { supabase, session };
}

// Ayarları getir: profil + bağlı kanal
export async function GET() {
  try {
    const { supabase, session } = await getSupabaseWithSession();

    if (!session?.user?.id) {
      return NextResponse.json(
        { success: false, error: "Unauthorized" },
        { status: 401 }
      );
    }

    const { data: channelData } = await supabase
      .from("user_channels")
      .select("channel_id")
      .eq("user_id", session.user.id)
      .maybeSingle();

    return NextResponse.json({
      success: true,
      settings: {
        email: session.user.email ?? "",
        createdAt: session.user.created_at ?? null,
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
    const { supabase, session } = await getSupabaseWithSession();

    if (!session?.user?.id) {
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
            "Geçersiz kanal ID. YouTube kanal ID'leri 'UC' ile başlar (örn: UCxxxxxxxxxxxxxxxxxxxxxx).",
        },
        { status: 400 }
      );
    }

    // Kayıt varsa güncelle, yoksa oluştur
    const { data: existing } = await supabase
      .from("user_channels")
      .select("id")
      .eq("user_id", session.user.id)
      .maybeSingle();

    if (existing) {
      const { error } = await supabase
        .from("user_channels")
        .update({ channel_id: channelId })
        .eq("user_id", session.user.id);

      if (error) throw new Error(error.message);
    } else {
      const { error } = await supabase.from("user_channels").insert({
        user_id: session.user.id,
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