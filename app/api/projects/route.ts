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

// Projeleri listele
export async function GET() {
  try {
    const { supabase, session } = await getSupabaseWithSession();

    if (!session?.user?.id) {
      return NextResponse.json(
        { success: false, error: "Unauthorized" },
        { status: 401 }
      );
    }

    const { data, error } = await supabase
      .from("projects")
      .select("id, title, platform, style, duration, idea, status, created_at")
      .eq("user_id", session.user.id)
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

// Yeni proje kaydet
export async function POST(request: Request) {
  try {
    const { supabase, session } = await getSupabaseWithSession();

    if (!session?.user?.id) {
      return NextResponse.json(
        { success: false, error: "Unauthorized" },
        { status: 401 }
      );
    }

    const body = await request.json();
    const { title, platform, style, duration, idea, content } = body;

    if (!title || typeof title !== "string") {
      return NextResponse.json(
        { success: false, error: "Proje başlığı gerekli." },
        { status: 400 }
      );
    }

    const { data, error } = await supabase
      .from("projects")
      .insert({
        user_id: session.user.id,
        title: title.trim(),
        platform: platform ?? null,
        style: style ?? null,
        duration: duration ?? null,
        idea: idea ?? null,
        content: content ?? null,
        status: "draft",
      })
      .select("id")
      .single();

    if (error) {
      throw new Error(error.message);
    }

    return NextResponse.json({ success: true, projectId: data.id });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    );
  }
}