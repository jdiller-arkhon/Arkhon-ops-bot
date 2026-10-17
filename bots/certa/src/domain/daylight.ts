/**
 * Sun times for Part 107 daylight rules. Same NOAA approximation Certa uses for its daylight
 * advisory (accurate to about a minute). All results are UTC instants.
 *
 * 14 CFR 107.29: civil twilight (sun up to 6° below the horizon) and night operations need
 * anti-collision lighting visible for 3 statute miles; night operations also need the updated
 * initial test or recurrent training.
 */
export interface SunTimes {
  civilDawn: Date | null;
  sunrise: Date | null;
  sunset: Date | null;
  civilDusk: Date | null;
  /** Set when the sun never rises or never sets that day. */
  polar: 'day' | 'night' | null;
}

const rad = (d: number) => (d * Math.PI) / 180;
const deg = (r: number) => (r * 180) / Math.PI;

/** Times the sun's centre crosses `altitude` degrees on the UTC calendar day of `date`. */
function crossing(date: Date, lat: number, lon: number, altitude: number) {
  const day0 = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  const n = Math.floor((day0 - Date.UTC(2000, 0, 1, 12)) / 86_400_000) + 1;
  const meanNoon = n - lon / 360;
  const M = (357.5291 + 0.98560028 * meanNoon) % 360;
  const C = 1.9148 * Math.sin(rad(M)) + 0.02 * Math.sin(rad(2 * M)) + 0.0003 * Math.sin(rad(3 * M));
  const lambda = (M + C + 180 + 102.9372) % 360;
  const transit =
    2451545 + meanNoon + 0.0053 * Math.sin(rad(M)) - 0.0069 * Math.sin(rad(2 * lambda));
  const decl = Math.asin(Math.sin(rad(lambda)) * Math.sin(rad(23.44)));
  const cosH =
    (Math.sin(rad(altitude)) - Math.sin(rad(lat)) * Math.sin(decl)) /
    (Math.cos(rad(lat)) * Math.cos(decl));
  if (cosH > 1) return { rise: null, set: null, polar: 'night' as const };
  if (cosH < -1) return { rise: null, set: null, polar: 'day' as const };
  const H = deg(Math.acos(cosH)) / 360;
  const toDate = (jd: number) => new Date((jd - 2440587.5) * 86_400_000);
  return { rise: toDate(transit - H), set: toDate(transit + H), polar: null };
}

/**
 * Sun times for the local day containing `localNoon` (pass noon local time so the UTC date
 * lines up with the local date for any US time zone).
 */
export function sunTimes(localNoon: Date, lat: number, lon: number): SunTimes {
  const civil = crossing(localNoon, lat, lon, -6);
  const sun = crossing(localNoon, lat, lon, -0.833);
  return {
    civilDawn: civil.rise,
    sunrise: sun.rise,
    sunset: sun.set,
    civilDusk: civil.set,
    polar: sun.polar ?? civil.polar,
  };
}

export type LightPeriod = 'day' | 'civil-twilight' | 'night';

/** Which Part 107 lighting period `now` falls in. */
export function lightPeriod(now: Date, t: SunTimes): LightPeriod {
  if (t.polar === 'day') return 'day';
  if (t.polar === 'night' && !t.civilDawn) return 'night';
  if (t.sunrise && t.sunset && now >= t.sunrise && now <= t.sunset) return 'day';
  if (t.civilDawn && t.civilDusk && now >= t.civilDawn && now <= t.civilDusk)
    return 'civil-twilight';
  return 'night';
}
