import { NextResponse } from "next/server";
import { getChannelGrowth } from "../../lib/channelGrowth";

export async function GET() {
  try {
    const result = await getChannelGrowth();

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
