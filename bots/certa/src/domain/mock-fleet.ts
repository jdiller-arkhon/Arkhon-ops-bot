import { DateTime } from 'luxon';
import type { Fleet } from '../certa/types.js';

/** Small stable hash so each mock pilot gets the same fleet every time. */
function seed(text: string): number {
  let h = 2166136261;
  for (const ch of text) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
  return h;
}

const AIRFRAMES = [
  { make: 'DJI', model: 'Mavic 3 Enterprise', nick: 'Hawkeye', batteryModel: 'Mavic 3' },
  { make: 'Skydio', model: 'X10', nick: 'Ghost', batteryModel: 'X10' },
  { make: 'DJI', model: 'Matrice 350 RTK', nick: 'Atlas', batteryModel: 'TB65' },
  { make: 'Autel', model: 'EVO II Pro', nick: 'Kestrel', batteryModel: 'EVO II' },
] as const;

/**
 * The demo fleet for a mock pilot (CERTA_API_MODE=mock): two aircraft and four batteries, with one
 * battery near its cycle limit and one registration expiring soon, so /fleet and /gonogo show
 * every state. Dates are relative to `today` (YYYY-MM-DD).
 */
export function mockFleet(certaUserId: string, today: string): Fleet {
  const h = seed(certaUserId);
  const day = DateTime.fromISO(today, { zone: 'utc' });
  const date = (days: number) => day.plus({ days }).toISODate()!;
  const first = AIRFRAMES[h % AIRFRAMES.length]!;
  const second = AIRFRAMES[(h + 1 + ((h >> 3) % (AIRFRAMES.length - 1))) % AIRFRAMES.length]!;
  const aircraft: Fleet['aircraft'] = [first, second].map((a, i) => ({
    id: `mock-ac-${i + 1}`,
    name: a.nick,
    makeModel: `${a.make} ${a.model}`,
    status: 'active',
    groundedReason: null,
    // Shaped like real FAA registrations (FA + 8 characters) but derived from the mock id.
    registrationNumber: `FA${(h >>> (i * 3)).toString(36).toUpperCase().padStart(8, '0').slice(-8)}`,
    serialNumber: `${a.make.slice(0, 2).toUpperCase()}${((h >>> (i * 4)) % 1e8).toString().padStart(8, '0')}`,
    // The second aircraft's registration is up soon; the first has years left.
    registrationExpiresOn: date(i === 0 ? 700 + (h % 300) : 20 + (h % 25)),
    maintenanceDueOn: date(i === 0 ? 30 + (h % 40) : 5 + (h % 10)),
    totalFlights: 40 + ((h >> (i * 5)) % 120),
    totalMinutes: 900 + ((h >> (i * 7)) % 4000),
  }));
  const batteries: Fleet['batteries'] = [0, 1, 2, 3].map((n) => {
    const fits = n < 2 ? first : second;
    const maxCycles = 200;
    const cycleCount = n === 3 ? 186 + (h % 10) : 20 + ((h >> n) % 120);
    return {
      id: `mock-bat-${n + 1}`,
      label: `${fits.batteryModel} #${(n % 2) + 1}`,
      status: cycleCount >= maxCycles * 0.9 ? 'watch' : 'active',
      cycleCount,
      maxCycles,
      aircraftModel: fits.model,
    };
  });
  return { aircraft, batteries };
}
