import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { generateVideoContent } from "../../../lib/gemini";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL as string;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY as string;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY as string;

// Cost per AI generation (in credits)
const GENERATION_COST = 5;

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

    const userId = session.user.id;

    const body = await request.json();
    const { idea, platform, style, duration, language } = body;

    if (!idea || typeof idea !== "string" || idea.trim().length < 5) {
      return NextResponse.json(
        { success: false, error: "Please enter a valid video idea." },
        { status: 400 }
      );
    }

    // Admin client for secure credit operations
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

    // Deduct credits BEFORE generation
    const { data: deducted, error: deductError } = await supabaseAdmin.rpc(
      "deduct_credits",
      {
        p_user_id: userId,
        p_amount: GENERATION_COST,
        p_reason: "AI content generation",
      }
    );

    if (deductError) {
      throw new Error(deductError.message);
    }

    if (!deducted) {
      return NextResponse.json(
        {
          success: false,
          error: `Not enough credits. Each generation costs ${GENERATION_COST} credits. Please top up your balance.`,
        },
        { status: 402 }
      );
    }

    try {
      const content = await generateVideoContent({
        idea: idea.trim(),
        platform: platform || "YouTube",
        style: style || "General",
        duration: duration || "60 seconds",
        language: language || "English",
      });

      return NextResponse.json({ success: true, content });
    } catch (generationError) {
      // Generation failed — refund the credits
      await supabaseAdmin.rpc("add_credits", {
        p_user_id: userId,
        p_amount: GENERATION_COST,
        p_type: "refund",
        p_reason: "Refund: generation failed",
      });

      throw generationError;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    );
  }
}