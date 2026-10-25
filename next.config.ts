import type { NextConfig } from "next";

const supabaseHost = (() => {
  try {
    return new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").hostname;
  } catch {
    return "";
  }
})();

const isDev = process.env.NODE_ENV !== "production";
const isVercelPreview = process.env.VERCEL_ENV === "preview";

// Content Security Policy.
// Enforced by default. Set CSP_REPORT_ONLY=true in Vercel to fall back to
// report-only mode (violations are logged in the browser console instead of
// being blocked) if a third-party script ever breaks after a release.
const cspDirectives = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  // Next.js injects inline bootstrap scripts; dev mode and React Refresh
  // additionally need eval. Vercel preview deployments load the Vercel
  // toolbar from vercel.live.
  [
    "script-src 'self' 'unsafe-inline'",
    isDev ? "'unsafe-eval'" : "",
    "https://cdn.paddle.com https://sandbox-cdn.paddle.com",
    isVercelPreview ? "https://vercel.live" : "",
  ]
    .filter(Boolean)
    .join(" "),
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com data:",
  // Thumbnails, stock footage previews, voice previews and generated clips
  // come from Supabase Storage, Pixabay/Pexels, ElevenLabs and Kling CDNs.
  "img-src 'self' data: blob: https:",
  "media-src 'self' blob: https:",
  "worker-src 'self' blob:",
  [
    "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://*.paddle.com",
    isVercelPreview ? "https://vercel.live wss://*.pusher.com" : "",
  ]
    .filter(Boolean)
    .join(" "),
  [
    "frame-src https://*.paddle.com",
    isVercelPreview ? "https://vercel.live" : "",
  ]
    .filter(Boolean)
    .join(" "),
  ...(isDev ? [] : ["upgrade-insecure-requests"]),
];

const cspHeaderKey =
  process.env.CSP_REPORT_ONLY === "true"
    ? "Content-Security-Policy-Report-Only"
    : "Content-Security-Policy";

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "i.ytimg.com" },
      { protocol: "https", hostname: "yt3.ggpht.com" },
      ...(supabaseHost
        ? [{ protocol: "https" as const, hostname: supabaseHost }]
        : []),
      { protocol: "https", hostname: "*.supabase.co" },
    ],
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Strict-Transport-Security",
            value: "max-age=63072000; includeSubDomains; preload",
          },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
          { key: cspHeaderKey, value: cspDirectives.join("; ") },
        ],
      },
    ];
  },
};

export default nextConfig;
