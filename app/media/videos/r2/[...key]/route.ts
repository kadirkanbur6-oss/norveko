// GET /media/videos/r2/<key> — stable address of a finished video stored in
// Cloudflare R2. Redirects to a signed URL valid for an hour (the bucket is
// private). ?download=<name> asks R2 to send it as a file download.
// Keys contain the job's random UUID, like the public Supabase video URLs.

import { NextResponse, type NextRequest } from "next/server";
import { r2Configured, signedR2Url } from "@/lib/storage/r2";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, { params }: { params: Promise<{ key: string[] }> }) {
  const { key: parts } = await params;
  if (!r2Configured() || !parts?.length || parts.some((p) => !p || p === "." || p === "..")) {
    return new NextResponse("Not found", { status: 404 });
  }
  const key = parts.map((p) => decodeURIComponent(p)).join("/");
  if (!/\.(mp4|mov|webm)$/i.test(key)) return new NextResponse("Not found", { status: 404 });
  const download = req.nextUrl.searchParams.get("download");
  const url = await signedR2Url(key, download);
  return NextResponse.redirect(url, {
    status: 302,
    headers: { "Cache-Control": "private, max-age=300" },
  });
}
