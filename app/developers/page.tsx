import type { Metadata } from "next";
import LegalLayout from "@/app/components/LegalLayout";

export const metadata: Metadata = {
  title: "API — Norveko",
  description: "Make videos with Norveko from your own tools: start a video, check its status, download the files.",
};

const START = `curl https://norveko.app/api/v1/videos \\
  -H "Authorization: Bearer nv_live_…" \\
  -H "Content-Type: application/json" \\
  -d '{
    "idea": "The Battle of Ankara, 1402",
    "platform": "YouTube Shorts",
    "style": "Documentary",
    "duration": "60 seconds",
    "language": "English",
    "footage": "hybrid"
  }'`;

const STARTED = `{ "id": "0541a734-…", "status": "running", "url": "/api/v1/videos/0541a734-…" }`;

const DONE = `{
  "id": "0541a734-…",
  "status": "completed",
  "credits": { "charged": 210, "refunded": 0 },
  "projectId": "981fd438-…",
  "result": {
    "videoUrl": "https://norveko.app/media/videos/…/final.mp4",
    "thumbnailUrl": "https://…",
    "titles": ["…"], "description": "…", "tags": ["…"],
    "script": "…", "captions": [{ "start": 0, "end": 2.4, "text": "…" }]
  }
}`;

export default function DevelopersPage() {
  return (
    <LegalLayout title="Norveko API">
      <section>
        <p>
          Start videos from your own app, a spreadsheet or an automation tool and pick up the finished MP4, thumbnail,
          titles and subtitles when they are ready. Every video made through the API uses your credits exactly like the
          AI Workspace.
        </p>
      </section>

      <section>
        <h2>1. Get a key</h2>
        <p>
          Create a key in <a href="/settings?tab=api">Settings → API</a> (available on any plan or pack) and send it with
          every request as <code>Authorization: Bearer nv_live_…</code>. Keep it secret; revoke it there if it leaks.
        </p>
      </section>

      <section>
        <h2>2. Start a video</h2>
        <p>
          <code>POST /api/v1/videos</code>
        </p>
        <pre>{START}</pre>
        <p>Response (201):</p>
        <pre>{STARTED}</pre>
        <p>Fields (all optional except <code>idea</code> or <code>url</code>):</p>
        <ul>
          <li><code>idea</code> — what the video is about.</li>
          <li><code>url</code> — a public article or blog page to make the video from.</li>
          <li><code>notes</code> — your angle or instructions for the writer (up to 500 characters).</li>
          <li><code>platform</code>, <code>style</code>, <code>duration</code>, <code>language</code>, <code>footage</code>, <code>clipMode</code>, <code>visualStyle</code>, <code>captionStyle</code>, <code>voiceId</code> — see <a href="/api/v1/options">/api/v1/options</a> for the accepted values.</li>
          <li><code>fullVideo</code> — <code>true</code> (default) for a finished MP4; <code>false</code> for the script, voice-over and thumbnail only.</li>
          <li><code>research</code> — search the web before writing (default on).</li>
          <li><code>characterIds</code> — up to 3 of your characters (ids from your workspace).</li>
          <li><code>useBrandKit</code> — apply your brand kit (logo, colour, end card).</li>
        </ul>
        <p>
          One video runs at a time per account and at most 10 start per hour. A request that can&apos;t be served returns
          an error like <code>{`{ "error": { "code": "insufficient_credits", "message": "…" } }`}</code>.
        </p>
      </section>

      <section>
        <h2>3. Check status and get the files</h2>
        <p>
          <code>GET /api/v1/videos/:id</code> — poll every 15–30 seconds. <code>status</code> is <code>running</code>,{" "}
          <code>completed</code> or <code>failed</code> (unused credits are refunded automatically).
        </p>
        <pre>{DONE}</pre>
        <p>
          <code>GET /api/v1/videos</code> lists your 20 most recent videos. <code>GET /api/v1/credits</code> returns your
          balance.
        </p>
      </section>

      <section>
        <h2>4. Skits with dialogue</h2>
        <p>
          <code>POST /api/v1/skits</code> with <code>{`{"script": "…the joke with each character's lines… make it like the viral cockroach videos", "orientation": "vertical"}`}</code>{" "}
          plans the cast and shots, charges the credits and starts making it. Poll <code>GET /api/v1/skits/:id</code> until{" "}
          <code>status</code> is <code>completed</code>; <code>video_url</code> is the finished MP4. <code>GET /api/v1/skits</code> lists your 20 most recent skits.
        </p>
      </section>

      <section>
        <h2>5. Good to know</h2>
        <ul>
          <li>A 60-second video usually takes 4–8 minutes; 10-minute videos take longer.</li>
          <li>API videos never pause for script review. Edit, translate or cut Shorts from them in the workspace.</li>
          <li>The same content rules apply as in the app (no children as characters, no explicit or unlawful content).</li>
        </ul>
      </section>
    </LegalLayout>
  );
}
