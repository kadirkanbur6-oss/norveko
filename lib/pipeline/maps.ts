// lib/pipeline/maps.ts
// Animated map scenes for history/geography videos (2 Nov 2026, Kadir).
// The script writer marks a scene with places (and whether they form a route);
// we draw a dark, timeless map (Natural Earth coastlines, no modern borders)
// as a few frames in which the places appear and the route draws itself.
// Place names are NOT baked into the picture (server fonts are unreliable):
// the render lays them on top as text, using the positions returned here.

import { geoMercator, geoPath, geoGraticule10 } from "d3-geo";
import { feature } from "topojson-client";
import type { Topology, GeometryCollection } from "topojson-specification";
import land50 from "world-atlas/land-50m.json";

import type { MapPlace, MapSpec } from "./maps-spec";
export type { MapPlace, MapSpec } from "./maps-spec";

export interface MapRender {
  frames: Buffer[];
  /** Where each place sits, as fractions of the frame (0..1). */
  labels: Array<{ name: string; x: number; y: number }>;
}

const COLORS = {
  sea: "#0b1520",
  seaGlow: "#13283a",
  land: "#3a3122",
  landEdge: "#8a7650",
  grid: "#1c3247",
  route: "#f2c14e",
  dot: "#ffffff",
};

let landCache: GeoJSON.FeatureCollection | GeoJSON.Feature | null = null;
function land() {
  if (!landCache) {
    const topo = land50 as unknown as Topology<{ land: GeometryCollection }>;
    landCache = feature(topo, topo.objects.land) as GeoJSON.FeatureCollection | GeoJSON.Feature;
  }
  return landCache;
}

/** Frame box around the places with breathing room (at least ~8° across). */
function extentFor(places: MapPlace[]): GeoJSON.Feature<GeoJSON.MultiPoint> {
  const lats = places.map((p) => p.lat);
  const lons = places.map((p) => p.lon);
  let [minLat, maxLat, minLon, maxLon] = [Math.min(...lats), Math.max(...lats), Math.min(...lons), Math.max(...lons)];
  const padLat = Math.max(3, (maxLat - minLat) * 0.35);
  const padLon = Math.max(4, (maxLon - minLon) * 0.3);
  minLat = Math.max(-80, minLat - padLat);
  maxLat = Math.min(80, maxLat + padLat);
  minLon = Math.max(-180, minLon - padLon);
  maxLon = Math.min(180, maxLon + padLon);
  return {
    type: "Feature",
    properties: {},
    // Corner points (a polygon's winding would make d3 fit the whole globe).
    geometry: {
      type: "MultiPoint",
      coordinates: [[minLon, minLat], [maxLon, minLat], [maxLon, maxLat], [minLon, maxLat]],
    },
  };
}

/** Points along the route (great-circle-ish straight segments in screen space). */
function routePoints(pts: Array<[number, number]>): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const [a, b] = [pts[i], pts[i + 1]];
    for (let t = 0; t < 1; t += 0.02) out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
  }
  out.push(pts[pts.length - 1]);
  return out;
}

/**
 * Draw the map as `count` frames: places appear one by one and, for a route,
 * the line grows from the first stop to the last. Returns JPEGs + label spots.
 */
export async function renderMapFrames(spec: MapSpec, orientation: "vertical" | "horizontal", count = 5): Promise<MapRender> {
  const sharp = (await import("sharp")).default;
  const [w, h] = orientation === "vertical" ? [1080, 1920] : [1920, 1080];
  // Keep places inside the middle band (the hook card sits on top, subtitles at the bottom).
  const pad = orientation === "vertical" ? { x: 120, top: 520, bottom: 560 } : { x: 220, top: 200, bottom: 260 };
  const projection = geoMercator().fitExtent(
    [
      [pad.x, pad.top],
      [w - pad.x, h - pad.bottom],
    ],
    extentFor(spec.places)
  );
  const path = geoPath(projection);
  const landPath = path(land()) ?? "";
  const gridPath = path(geoGraticule10()) ?? "";
  const pts = spec.places.map((p) => projection([p.lon, p.lat]) as [number, number]);
  const line = spec.route ? routePoints(pts) : [];

  const frames: Buffer[] = [];
  const n = Math.max(2, count);
  for (let f = 0; f < n; f++) {
    const progress = f / (n - 1);
    const shown = spec.route ? pts.filter((_, i) => i / Math.max(1, pts.length - 1) <= progress + 1e-6) : pts.slice(0, Math.max(1, Math.ceil(progress * pts.length)));
    const drawn = spec.route ? line.slice(0, Math.max(1, Math.round(progress * line.length))) : [];
    const head = drawn[drawn.length - 1];
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  <defs>
    <radialGradient id="sea" cx="50%" cy="45%" r="75%"><stop offset="0%" stop-color="${COLORS.seaGlow}"/><stop offset="100%" stop-color="${COLORS.sea}"/></radialGradient>
    <radialGradient id="vignette" cx="50%" cy="50%" r="70%"><stop offset="60%" stop-color="#000" stop-opacity="0"/><stop offset="100%" stop-color="#000" stop-opacity="0.65"/></radialGradient>
  </defs>
  <rect width="${w}" height="${h}" fill="url(#sea)"/>
  <path d="${gridPath}" fill="none" stroke="${COLORS.grid}" stroke-width="1.2"/>
  <path d="${landPath}" fill="${COLORS.land}" stroke="${COLORS.landEdge}" stroke-width="2" stroke-linejoin="round"/>
  ${drawn.length > 1 ? `<polyline points="${drawn.map((p) => p.join(",")).join(" ")}" fill="none" stroke="${COLORS.route}" stroke-width="9" stroke-linecap="round" stroke-linejoin="round" stroke-dasharray="26 16"/>` : ""}
  ${head && spec.route && progress < 1 ? `<circle cx="${head[0]}" cy="${head[1]}" r="14" fill="${COLORS.route}"/>` : ""}
  ${shown.map((p) => `<circle cx="${p[0]}" cy="${p[1]}" r="22" fill="none" stroke="${COLORS.route}" stroke-width="5" opacity="0.7"/><circle cx="${p[0]}" cy="${p[1]}" r="11" fill="${COLORS.dot}"/>`).join("")}
  <rect width="${w}" height="${h}" fill="url(#vignette)"/>
</svg>`;
    frames.push(await sharp(Buffer.from(svg)).jpeg({ quality: 86 }).toBuffer());
  }
  return {
    frames,
    labels: spec.places.map((p, i) => ({ name: p.name, x: Math.round((pts[i][0] / w) * 1000) / 1000, y: Math.round((pts[i][1] / h) * 1000) / 1000 })),
  };
}
