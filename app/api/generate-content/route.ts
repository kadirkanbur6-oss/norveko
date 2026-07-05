import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { generateVideoContent } from "../../../lib/gemini";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL as string;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY as string;

export async function POST(request: Request) {
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

    const body = await request.json();
    const { idea, platform, style, duration } = body;

    if (!idea || typeof idea !== "string" || idea.trim().length < 5) {
      return NextResponse.json(
        { success: false, error: "Lütfen geçerli bir video fikri girin." },
        { status: 400 }
      );
    }

    const content = await generateVideoContent({
      idea: idea.trim(),
      platform: platform || "YouTube",
      style: style || "Genel",
      duration: duration || "60 saniye",
    });

    return NextResponse.json({ success: true, content });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    );
  }
}