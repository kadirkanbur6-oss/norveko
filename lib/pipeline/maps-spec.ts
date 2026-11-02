// lib/pipeline/maps-spec.ts — map scene data (pure; the drawing lives in maps.ts).

export interface MapPlace {
  name: string;
  lat: number;
  lon: number;
}

export interface MapSpec {
  title?: string;
  places: MapPlace[];
  /** Places are stops of a journey/campaign, drawn as a line in order. */
  route?: boolean;
}

/** Validate what the script writer produced. */
export function readMapSpec(raw: unknown): MapSpec | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const places = (Array.isArray(r.places) ? r.places : [])
    .map((p) => {
      const o = (p ?? {}) as Record<string, unknown>;
      return { name: String(o.name ?? "").trim().slice(0, 32), lat: Number(o.lat), lon: Number(o.lon) };
    })
    .filter((p) => p.name && Number.isFinite(p.lat) && Number.isFinite(p.lon) && Math.abs(p.lat) <= 85 && Math.abs(p.lon) <= 180)
    .slice(0, 6);
  if (!places.length) return null;
  return {
    title: typeof r.title === "string" && r.title.trim() ? r.title.trim().slice(0, 60) : undefined,
    places,
    route: r.route === true && places.length >= 2,
  };
}

