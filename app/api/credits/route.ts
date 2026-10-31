import { NextResponse } from "next/server";
import { requireUser } from "@/lib/supabase-server";


export async function GET() {
  try {
    const { supabase, user } = await requireUser();

    if (!user) {
      return NextResponse.json(
        { success: false, error: "Unauthorized" },
        { status: 401 }
      );
    }

    const { data: creditData } = await supabase
      .from("user_credits")
      .select("credits")
      .eq("user_id", user.id)
      .maybeSingle();

    const { data: transactions } = await supabase
      .from("credit_transactions")
      .select("id, type, amount, reason, created_at")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(20);

    // Free trial = no purchase yet → generated thumbnails/videos carry the badge.
    const { count: purchases } = await supabase
      .from("credit_transactions")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id)
      .eq("type", "purchase");
    const { isWatermarkExempt } = await import("@/lib/pipeline/watermark-policy");

    return NextResponse.json({
      success: true,
      credits: creditData?.credits ?? 0,
      transactions: transactions ?? [],
      freeTrial: !isWatermarkExempt(user.id) && (purchases ?? 0) === 0,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    );
  }
}