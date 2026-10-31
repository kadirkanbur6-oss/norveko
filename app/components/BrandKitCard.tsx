"use client";

// Settings: the creator's brand kit — logo, brand colour, end-card line.
// Applied to new videos and thumbnails (lib/brand/kit.ts).

import { useEffect, useRef, useState } from "react";
import { ImagePlus, Loader2, Palette, Trash2 } from "lucide-react";
import { contrastText as contrast } from "@/lib/brand/kit";

interface Kit {
  logoUrl: string | null;
  color: string | null;
  outroText: string | null;
  logoOnVideo: boolean;
  logoOnThumbnail: boolean;
}

const SWATCHES = ["#7C3AED", "#2563EB", "#DC2626", "#F59E0B", "#10B981", "#EC4899", "#FFFFFF", "#111827"];
const OUTRO_MAX = 60;

export default function BrandKitCard() {
  const [kit, setKit] = useState<Kit | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [color, setColor] = useState<string>("");
  const [outro, setOutro] = useState("");
  const [logoOnVideo, setLogoOnVideo] = useState(true);
  const [logoOnThumbnail, setLogoOnThumbnail] = useState(true);
  const [busy, setBusy] = useState<"" | "save" | "logo" | "remove">("");
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  function apply(k: Kit | null) {
    setKit(k);
    setColor(k?.color ?? "");
    setOutro(k?.outroText ?? "");
    setLogoOnVideo(k?.logoOnVideo ?? true);
    setLogoOnThumbnail(k?.logoOnThumbnail ?? true);
  }

  useEffect(() => {
    fetch("/api/brand")
      .then((r) => r.json())
      .then((d) => apply(d.kit ?? null))
      .catch(() => undefined)
      .finally(() => setLoaded(true));
  }, []);

  async function save() {
    setBusy("save");
    setMessage(null);
    try {
      const res = await fetch("/api/brand", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ color: color || null, outroText: outro, logoOnVideo, logoOnThumbnail }),
      });
      const d = await res.json();
      if (!d.success) throw new Error(d.error || "Couldn't save.");
      apply(d.kit);
      setMessage({ ok: true, text: "Brand kit saved. New videos will use it." });
    } catch (err) {
      setMessage({ ok: false, text: err instanceof Error ? err.message : "Couldn't save." });
    } finally {
      setBusy("");
    }
  }

  async function upload(file: File) {
    setBusy("logo");
    setMessage(null);
    try {
      const form = new FormData();
      form.append("logo", file);
      const d = await fetch("/api/brand", { method: "POST", body: form }).then((r) => r.json());
      if (!d.success) throw new Error(d.error || "Upload failed.");
      apply(d.kit);
      setMessage({ ok: true, text: "Logo uploaded." });
    } catch (err) {
      setMessage({ ok: false, text: err instanceof Error ? err.message : "Upload failed." });
    } finally {
      setBusy("");
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function removeLogo() {
    setBusy("remove");
    const d = await fetch("/api/brand?part=logo", { method: "DELETE" }).then((r) => r.json()).catch(() => null);
    if (d?.success) apply(d.kit);
    setBusy("");
  }

  const previewColor = color || "#000000";

  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-6">
      <div className="flex items-center gap-2">
        <Palette size={18} className="text-purple-300" aria-hidden />
        <h2 className="font-semibold">Brand kit</h2>
      </div>
      <p className="mt-2 text-sm text-gray-400">
        Your logo, colour and end-card line on every new video and thumbnail. You can switch it off per video in the AI Workspace.
      </p>

      {!loaded ? (
        <p className="mt-4 flex items-center gap-2 text-sm text-gray-400">
          <Loader2 size={15} className="animate-spin" aria-hidden /> Loading…
        </p>
      ) : (
        <div className="mt-5 grid gap-6 md:grid-cols-[1fr_180px]">
          <div className="space-y-5">
            {/* Logo */}
            <div>
              <p className="mb-2 text-xs uppercase tracking-wider text-gray-500">Logo</p>
              <div className="flex flex-wrap items-center gap-3">
                <div className="flex h-16 w-16 items-center justify-center overflow-hidden rounded-xl border border-white/10 bg-[repeating-conic-gradient(#1f1f2e_0%_25%,#16161f_0%_50%)] bg-[length:16px_16px]">
                  {kit?.logoUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={kit.logoUrl} alt="Your logo" className="max-h-14 max-w-14 object-contain" />
                  ) : (
                    <ImagePlus size={20} className="text-gray-500" aria-hidden />
                  )}
                </div>
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  className="hidden"
                  onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])}
                />
                <button
                  type="button"
                  onClick={() => fileRef.current?.click()}
                  disabled={busy !== ""}
                  className="inline-flex items-center gap-2 rounded-xl border border-white/10 px-4 py-2 text-sm text-gray-200 transition hover:border-purple-400/40 disabled:opacity-50"
                >
                  {busy === "logo" ? <Loader2 size={15} className="animate-spin" aria-hidden /> : <ImagePlus size={15} aria-hidden />}
                  {kit?.logoUrl ? "Replace logo" : "Upload logo"}
                </button>
                {kit?.logoUrl && (
                  <button
                    type="button"
                    onClick={removeLogo}
                    disabled={busy !== ""}
                    aria-label="Remove logo"
                    className="rounded-xl border border-white/10 p-2 text-gray-400 transition hover:text-red-300 disabled:opacity-50"
                  >
                    <Trash2 size={15} aria-hidden />
                  </button>
                )}
              </div>
              <p className="mt-2 text-xs text-gray-500">PNG with a transparent background works best. Max 2 MB.</p>
              {kit?.logoUrl && (
                <div className="mt-3 flex flex-wrap gap-4 text-sm text-gray-300">
                  <label className="flex items-center gap-2">
                    <input type="checkbox" checked={logoOnVideo} onChange={(e) => setLogoOnVideo(e.target.checked)} className="h-4 w-4 accent-purple-500" />
                    On videos (top-left)
                  </label>
                  <label className="flex items-center gap-2">
                    <input type="checkbox" checked={logoOnThumbnail} onChange={(e) => setLogoOnThumbnail(e.target.checked)} className="h-4 w-4 accent-purple-500" />
                    On thumbnails
                  </label>
                </div>
              )}
            </div>

            {/* Colour */}
            <div>
              <p className="mb-2 text-xs uppercase tracking-wider text-gray-500">Brand colour</p>
              <div className="flex flex-wrap items-center gap-2">
                {SWATCHES.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setColor(c)}
                    aria-label={`Use ${c}`}
                    aria-pressed={color.toUpperCase() === c}
                    className={`h-8 w-8 rounded-full border-2 transition ${color.toUpperCase() === c ? "border-white" : "border-white/10"}`}
                    style={{ background: c }}
                  />
                ))}
                <input
                  type="color"
                  value={color || "#7C3AED"}
                  onChange={(e) => setColor(e.target.value.toUpperCase())}
                  aria-label="Custom colour"
                  className="h-8 w-10 cursor-pointer rounded border border-white/10 bg-transparent"
                />
                {color && (
                  <button type="button" onClick={() => setColor("")} className="text-xs text-gray-400 hover:text-white">
                    No colour
                  </button>
                )}
              </div>
              <p className="mt-2 text-xs text-gray-500">Used for the hook card at the start and the end card. Subtitles keep their own colours.</p>
            </div>

            {/* End card */}
            <div>
              <label htmlFor="brand-outro" className="mb-2 block text-xs uppercase tracking-wider text-gray-500">
                End card
              </label>
              <input
                id="brand-outro"
                value={outro}
                maxLength={OUTRO_MAX}
                onChange={(e) => setOutro(e.target.value)}
                placeholder="Follow @yourchannel for more"
                className="w-full rounded-xl border border-white/10 bg-[#12121c] p-3 text-sm text-white outline-none focus:border-purple-400/50"
              />
              <p className="mt-1 text-xs text-gray-500">Shown over the last 2.5 seconds. Leave empty for none. {outro.length}/{OUTRO_MAX}</p>
            </div>

            <button
              type="button"
              onClick={save}
              disabled={busy !== ""}
              className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-blue-500 to-purple-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-50"
            >
              {busy === "save" && <Loader2 size={15} className="animate-spin" aria-hidden />}
              Save brand kit
            </button>
          </div>

          {/* Preview */}
          <div aria-hidden className="relative mx-auto h-[320px] w-[180px] overflow-hidden rounded-2xl border border-white/10 bg-gradient-to-b from-slate-700 via-slate-800 to-slate-950">
            {kit?.logoUrl && logoOnVideo && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={kit.logoUrl} alt="" className="absolute left-2 top-3 max-h-8 max-w-[52px] object-contain" />
            )}
            <div
              className="absolute inset-x-3 top-[30%] rounded-lg px-2 py-1.5 text-center text-[11px] font-extrabold uppercase leading-tight"
              style={{ background: color || "rgba(0,0,0,.45)", color: color ? contrast(color) : "#fff" }}
            >
              The lighthouse went dark
            </div>
            <div className="absolute inset-x-3 bottom-[18%] text-center text-[11px] font-extrabold uppercase text-white [text-shadow:0_1px_3px_#000]">
              Three men <span style={{ color: "#FFD60A" }}>vanished</span>
            </div>
            {outro && (
              <div
                className="absolute inset-x-4 top-[52%] rounded-lg px-2 py-1 text-center text-[10px] font-bold leading-tight"
                style={{ background: previewColor, color: contrast(previewColor) }}
              >
                {outro}
              </div>
            )}
          </div>
        </div>
      )}

      {message && (
        <p
          className={`mt-4 rounded-xl border p-3 text-sm ${
            message.ok ? "border-green-400/30 bg-green-500/10 text-green-300" : "border-red-400/30 bg-red-500/10 text-red-300"
          }`}
        >
          {message.text}
        </p>
      )}
    </div>
  );
}

