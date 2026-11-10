// lib/lab/promo.ts
// The homepage tour (10 Nov 2026, Yağmur: "add the newer features to the promo video, with
// narration"): a trailer made of real Norveko outputs (lib/showcase.ts), narrated by a Gemini
// voice, captioned and set to music, rendered by Shotstack and kept in R2 as site/promo-tour.mp4.
// Lab actions promo-tts → promo-render → transcode-finish (see app/api/lab/route.ts).

import "server-only";

const OWNER = "92779a9c-cb1c-47a8-bcc8-e07f4de6dc56";

export type PromoScene = {
  tag: string;
  title: string;
  /** What the narrator says (also shown as the caption). */
  text: string;
  /** Vertical showcase clip shown in a phone-shaped frame, on the given side. */
  clip?: { key: string; seconds: number; side: "left" | "right"; trim?: number };
  /** Full-bleed picture (Ken Burns) instead of a phone clip. */
  image?: string;
  /** Full-bleed 16:9 clip (hero loop) behind the text. */
  wide?: { key: string; trim?: number };
};

export const PROMO_SCENES: PromoScene[] = [
  {
    tag: "NORVEKO",
    title: "One idea.\nA finished video.",
    text: "One idea. That's all Norveko needs to make a finished video.",
    wide: { key: "site/hero-rooftop-jump.mp4" },
  },
  {
    tag: "NARRATED VIDEOS",
    title: "Researched, narrated,\nrendered",
    text: "Type a topic, and it researches the facts, writes and fact-checks the script, records the narration, makes the visuals, adds music and subtitles, and renders the video.",
    clip: { key: `${OWNER}/93ad4e8c-9e77-4f4b-8fad-b548186f0198/final.mp4`, seconds: 60, side: "right" },
  },
  {
    tag: "29 LANGUAGES",
    title: "Up to 10 minutes.\nAny language.",
    text: "Up to ten minutes long, in twenty-nine languages. And one click translates any video into a brand new one.",
    clip: { key: `${OWNER}/109f14d7-c2b8-4f6f-b7b3-b13afaef73a0/final.mp4`, seconds: 60, side: "left" },
  },
  {
    tag: "ANIMATED SKITS",
    title: "Turn a joke\ninto a skit",
    text: "Got a joke? Norveko turns it into an animated skit, where the characters speak their own lines.",
    clip: { key: `${OWNER}/skit/41afe86b-079f-4127-ae59-ec40b8f61f54/final.mp4`, seconds: 21, side: "right" },
  },
  {
    tag: "TALKING CHARACTERS",
    title: "Make any\ncharacter talk",
    text: "Make any character talk. Add a photo, type a line, and they say it on camera.",
    clip: { key: `${OWNER}/talk/bb366887-daff-4a6b-be18-55847bdf8c74/final.mp4`, seconds: 12, side: "left" },
  },
  {
    tag: "YOU IN THE STORY",
    title: "Put yourself\nin the scene",
    text: "Put yourself in the story, swap a character into any clip, or bring a single picture to life.",
    clip: { key: `${OWNER}/talk/3327ef3a-6a10-4100-bdd7-9a8c588845b9/final.mp4`, seconds: 8, side: "right" },
  },
  {
    tag: "AMBIENT MUSIC",
    title: "Hours of calm,\nfrom one sentence",
    text: "Want hours of calm music? Describe a world, and Norveko composes the songs, paints the scenes, and renders a two-hour ambient video.",
    /** Filled by the promo-image lab action (public URL). */
    image: "AMBIENT_IMAGE",
  },
  {
    tag: "SHORTS & BRAND KIT",
    title: "Long video in,\nShorts out",
    text: "Cut long videos into Shorts, and keep your logo and colors on every frame.",
    clip: { key: `${OWNER}/a3a69a3d-b950-4e5f-b82a-7e9227de4be9/final-v4.mp4`, seconds: 40, side: "left" },
  },
  {
    tag: "NORVEKO",
    title: "From one idea\nto a finished video",
    text: "Norveko. From one idea to a finished video. Start free today.",
    wide: { key: "site/hero-rooftop-jump.mp4", trim: 4 },
  },
];

export const PROMO_VOICE = "Zephyr";
export const PROMO_DIRECTION = "Say this as an upbeat, confident narrator of a product trailer, at a lively pace:";
export const GAP = 0.3;

export type PromoManifest = { ambientImage?: string; voice: string; segments: { n: number; url: string; seconds: number }[] };

/** Duration of a mono 16-bit WAV made by pcmToWav (44-byte header). */
export const wavSeconds = (bytes: number, rate = 24000) => (bytes - 44) / (rate * 2);

type Clip = Record<string, unknown>;

export function buildPromoEdit(args: {
  manifest: PromoManifest;
  urlFor: (key: string) => Promise<string>;
  musicUrl: string;
  logoUrl: string;
}): Promise<Record<string, unknown>> {
  return (async () => {
    const { manifest, urlFor, musicUrl, logoUrl } = args;
    for (const sc of PROMO_SCENES) if (sc.image === "AMBIENT_IMAGE") sc.image = manifest.ambientImage ?? "";
    const W = 1920;
    const H = 1080;
    const layers: Clip[][] = [[], [], [], [], []]; // 0 caption+title text, 1 chip, 2 media, 3 extra, 4 background media
    const voice: Clip[] = [];
    let t = 0;
    for (let i = 0; i < PROMO_SCENES.length; i++) {
      const sc = PROMO_SCENES[i];
      const seg = manifest.segments.find((s) => s.n === i);
      if (!seg) throw new Error(`missing narration for scene ${i}`);
      const len = Math.round((seg.seconds + GAP) * 100) / 100;
      voice.push({ asset: { type: "audio", src: seg.url, volume: 1 }, start: Math.round(t * 100) / 100, length: Math.round(seg.seconds * 100) / 100 });

      const phone = sc.clip;
      // Text column: the side opposite the phone (or centred for full-bleed scenes).
      const textX = phone ? (phone.side === "right" ? -0.2 : 0.2) : 0;
      const textW = phone ? 820 : 1500;
      const align = phone ? "left" : "center";

      layers[0].push({
        asset: {
          type: "rich-text",
          text: sc.title,
          font: { family: "Montserrat ExtraBold", size: phone ? 84 : 110, color: "#FFFFFF", weight: 800 },
          style: { lineHeight: 1.05 },
          shadow: { offsetX: 0, offsetY: 4, blur: 14, color: "#000000", opacity: 0.55 },
          align: { horizontal: align, vertical: "middle" },
          animation: { preset: "slideIn", style: "word", direction: "up", duration: 0.4 },
        },
        start: Math.round(t * 100) / 100,
        length: len,
        width: textW,
        height: phone ? 280 : 360,
        position: "center",
        offset: { x: textX, y: phone ? 0.2 : 0.08 },
        transition: { out: "fade" },
      });
      layers[0].push({
        asset: {
          type: "rich-text",
          text: sc.text,
          font: { family: "Montserrat Medium", size: phone ? 34 : 40, color: "#E5E7EB", weight: 500 },
          style: { lineHeight: 1.3 },
          background: { color: "#000000", opacity: 0.5, borderRadius: 18, wrap: true },
          padding: 22,
          align: { horizontal: align, vertical: "middle" },
          animation: { preset: "fadeIn", duration: 0.35 },
        },
        start: Math.round(t * 100) / 100,
        length: len,
        width: textW,
        height: phone ? 330 : 260,
        position: "center",
        offset: { x: textX, y: phone ? -0.2 : -0.3 },
        transition: { out: "fade" },
      });
      layers[1].push({
        asset: {
          type: "rich-text",
          text: sc.tag,
          font: { family: "Montserrat ExtraBold", size: 28, color: "#93C5FD", weight: 800 },
          background: { color: "#1D4ED8", opacity: 0.35, borderRadius: 999, wrap: true },
          padding: 16,
          align: { horizontal: align, vertical: "middle" },
        },
        start: Math.round(t * 100) / 100,
        length: len,
        width: phone ? 520 : 640,
        height: 70,
        position: "center",
        offset: { x: textX, y: phone ? 0.38 : 0.28 },
        transition: { out: "fade" },
      });

      if (phone) {
        layers[2].push({
          asset: { type: "video", src: await urlFor(phone.key), volume: 0, trim: phone.trim ?? 0 },
          start: Math.round(t * 100) / 100,
          length: Math.min(len, phone.seconds),
          fit: "crop",
          width: 540,
          height: 960,
          position: "center",
          offset: { x: phone.side === "right" ? 0.22 : -0.22, y: 0 },
          transition: { in: "fade", out: "fade" },
        });
      } else if (sc.wide) {
        layers[4].push({
          asset: { type: "video", src: await urlFor(sc.wide.key), volume: 0, trim: sc.wide.trim ?? 0 },
          start: Math.round(t * 100) / 100,
          length: len,
          fit: "cover",
          transition: { in: "fade", out: "fade" },
        });
        layers[3].push({
          asset: { type: "rich-text", text: " ", font: { family: "Montserrat", size: 10, color: "#000000" }, background: { color: "#000000", opacity: 0.38 } },
          start: Math.round(t * 100) / 100,
          length: len,
          width: W,
          height: H,
          position: "center",
        });
        if (i === PROMO_SCENES.length - 1) {
          layers[3].push({
            asset: { type: "image", src: logoUrl },
            start: Math.round(t * 100) / 100,
            length: len,
            fit: "contain",
            scale: 0.16,
            position: "center",
            offset: { x: 0, y: 0.28 },
            transition: { in: "fade" },
          });
        }
      } else if (sc.image) {
        layers[4].push({
          asset: { type: "image", src: sc.image.startsWith("http") ? sc.image : await urlFor(sc.image) },
          start: Math.round(t * 100) / 100,
          length: len,
          fit: "cover",
          effect: "zoomInSlow",
          transition: { in: "fade", out: "fade" },
        });
        layers[3].push({
          asset: { type: "rich-text", text: " ", font: { family: "Montserrat", size: 10, color: "#000000" }, background: { color: "#000000", opacity: 0.35 } },
          start: Math.round(t * 100) / 100,
          length: len,
          width: W,
          height: H,
          position: "center",
        });
      }
      t += seg.seconds + GAP;
    }
    const total = Math.round(t * 100) / 100;
    const tracks = [
      ...layers.map((clips) => ({ clips })),
      { clips: voice },
      { clips: [{ asset: { type: "audio", src: musicUrl, volume: 0.1, effect: "fadeInFadeOut" }, start: 0, length: total }] },
    ].filter((tr) => tr.clips.length);
    return {
      timeline: { background: "#07070d", tracks },
      output: { format: "mp4", size: { width: W, height: H }, fps: 30, quality: "high" },
    };
  })();
}
