// lib/pipeline/shotstack.ts
// Shotstack Edit API client: submit a render, poll it, download the result.
// Server-only. Env: SHOTSTACK_API_KEY, SHOTSTACK_ENV ("stage" = sandbox with
// watermark, "v1" = production). The edit JSON is built in timeline.ts.

if (!process.env.SHOTSTACK_API_KEY) {
  throw new Error("SHOTSTACK_API_KEY is not set.");
}

const ENV = process.env.SHOTSTACK_ENV === "v1" ? "v1" : "stage";
const BASE = `https://api.shotstack.io/edit/${ENV}`;

export type ShotstackStatus = "queued" | "fetching" | "rendering" | "saving" | "done" | "failed";

export interface ShotstackRenderResult {
  id: string;
  status: ShotstackStatus;
  url?: string;
  error?: string;
  /** Seconds of output as reported by Shotstack (for the cost log). */
  duration?: number;
  renderTime?: number;
}

function headers() {
  return {
    "x-api-key": process.env.SHOTSTACK_API_KEY!,
    "Content-Type": "application/json",
    Accept: "application/json",
  };
}

/** Submit an edit. Returns the render id. */
export async function submitRender(edit: Record<string, unknown>): Promise<string> {
  const res = await fetch(`${BASE}/render`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify(edit),
    cache: "no-store",
  });
  const raw = await res.text();
  let body: { success?: boolean; message?: string; response?: { id?: string; message?: string; error?: unknown } } = {};
  try {
    body = JSON.parse(raw);
  } catch {
    // non-JSON (gateway / WAF page) — surfaced below
  }
  if (!res.ok || !body?.response?.id) {
    const msg = body?.response?.message ?? body?.message ?? raw.replace(/\s+/g, " ").slice(0, 200) ?? `HTTP ${res.status}`;
    throw new Error(`Shotstack submit failed (HTTP ${res.status}, ${ENV}): ${String(msg).slice(0, 300)}`);
  }
  return body.response.id;
}

/** Poll a render. */
export async function getRender(id: string): Promise<ShotstackRenderResult> {
  const res = await fetch(`${BASE}/render/${encodeURIComponent(id)}?data=false&merged=false`, {
    headers: headers(),
    cache: "no-store",
  });
  const body = (await res.json().catch(() => ({}))) as {
    response?: {
      id?: string;
      status?: ShotstackStatus;
      url?: string;
      error?: string;
      duration?: number;
      renderTime?: number;
    };
    message?: string;
  };
  if (!res.ok || !body?.response) {
    throw new Error(`Shotstack status failed: ${String(body?.message ?? res.status).slice(0, 200)}`);
  }
  const r = body.response;
  return {
    id: r.id ?? id,
    status: r.status ?? "queued",
    url: r.url,
    error: r.error,
    duration: r.duration,
    renderTime: r.renderTime,
  };
}

/** Download the finished MP4 so it can live in our own bucket. */
export async function downloadRender(url: string): Promise<Buffer> {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`Could not download render (HTTP ${res.status}).`);
  return Buffer.from(await res.arrayBuffer());
}

/** Whether a Shotstack status is terminal. */
export function isTerminal(status: ShotstackStatus): boolean {
  return status === "done" || status === "failed";
}
