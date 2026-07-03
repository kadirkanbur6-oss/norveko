import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { getChannelGrowth } from "../../lib/channelGrowth";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL as string;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY as string;

export async function GET() {
  try {
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
      error: sessionError,
    } = await supabase.auth.getSession();

    if (sessionError || !session?.user?.id) {
      return NextResponse.json(
        { success: false, error: "Unauthorized" },
        { status: 401 }
      );
    }

    const { data: channelData, error: channelError } = await supabase
      .from("user_channels")
      .select("channel_id")
      .eq("user_id", session.user.id)
      .maybeSingle();

    if (channelError || !channelData?.channel_id) {
      return NextResponse.json(
        { success: false, error: "No connected YouTube channel found." },
        { status: 400 }
      );
    }

    const result = await getChannelGrowth(channelData.channel_id, session.user.id);

    if (!result.success) {
      return NextResponse.json(
        { success: false, error: result.error ?? "Failed to compute growth" },
        { status: 500 }
      );
    }

    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
