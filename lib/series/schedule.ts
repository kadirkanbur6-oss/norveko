// lib/series/schedule.ts
// Pure schedule maths for series autopilot: "post on these weekdays at HH:MM
// in this time zone" → concrete UTC instants. No date library: the zone
// offset comes from Intl (handles DST).

export const CADENCE_PRESETS = [
  { id: "daily", label: "Every day", days: [0, 1, 2, 3, 4, 5, 6] },
  { id: "weekdays", label: "Weekdays", days: [1, 2, 3, 4, 5] },
  { id: "3x", label: "3× a week", days: [1, 3, 5] },
  { id: "weekly", label: "Once a week", days: [1] },
] as const;

export function isValidTimeZone(tz: unknown): tz is string {
  if (typeof tz !== "string" || !tz) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export function isValidTime(value: unknown): value is string {
  return typeof value === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

/** Wall-clock parts of an instant in a zone. */
function partsIn(date: Date, tz: string) {
  const f = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    weekday: "short",
  });
  const p = Object.fromEntries(f.formatToParts(date).map((x) => [x.type, x.value]));
  const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(p.weekday);
  return { y: +p.year, m: +p.month, d: +p.day, h: +p.hour, min: +p.minute, s: +p.second, weekday };
}

/** UTC instant of a wall-clock time in a zone (two passes settle DST edges). */
export function zonedToUtc(y: number, m: number, d: number, h: number, min: number, tz: string): Date {
  let guess = Date.UTC(y, m - 1, d, h, min);
  for (let i = 0; i < 2; i++) {
    const p = partsIn(new Date(guess), tz);
    const asUtc = Date.UTC(p.y, p.m - 1, p.d, p.h, p.min, p.s);
    guess += Date.UTC(y, m - 1, d, h, min) - asUtc;
  }
  return new Date(guess);
}

/**
 * Post times strictly after `from` and at most `withinHours` later.
 * days: 0 = Sunday … 6 = Saturday (in the series' time zone).
 */
export function upcomingSlots(
  schedule: { days: number[]; time: string; timezone: string },
  from: Date,
  withinHours: number
): Date[] {
  const [hh, mm] = schedule.time.split(":").map(Number);
  const until = from.getTime() + withinHours * 3600_000;
  const out: Date[] = [];
  const start = partsIn(from, schedule.timezone);
  // Walk local calendar days from yesterday (zone/DST safety) forward.
  for (let offset = -1; offset <= Math.ceil(withinHours / 24) + 1; offset++) {
    const local = new Date(Date.UTC(start.y, start.m - 1, start.d + offset));
    const weekday = local.getUTCDay();
    if (!schedule.days.includes(weekday)) continue;
    const at = zonedToUtc(local.getUTCFullYear(), local.getUTCMonth() + 1, local.getUTCDate(), hh, mm, schedule.timezone);
    if (at.getTime() > from.getTime() && at.getTime() <= until) out.push(at);
  }
  return out.sort((a, b) => a.getTime() - b.getTime());
}

/** The next post time after `from` (searches two weeks). */
export function nextSlot(schedule: { days: number[]; time: string; timezone: string }, from: Date): Date | null {
  return upcomingSlots(schedule, from, 24 * 15)[0] ?? null;
}
