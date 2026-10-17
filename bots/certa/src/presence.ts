import { ActivityType, type Client, type PresenceData } from 'discord.js';
import type { CertaContext } from './context.js';
import { formatKp } from './preflight/assess.js';

/** Live numbers the status lines show. Anything that could not be read is null and its line skipped. */
export interface PresenceStats {
  /** Conditions at the status airport, from the cached preflight report. */
  wx: {
    icao: string;
    level: 'GO' | 'CAUTION';
    windKt: number | null;
    gustKt: number | null;
    reason: string | null;
  } | null;
  kp: number | null;
  /** Calendar month name, e.g. "October". */
  month: string;
  flightsThisMonth: number | null;
  leader: { name: string; minutes: number } | null;
  linkedPilots: number | null;
}

/** How often the custom status changes. */
export const PRESENCE_ROTATE_MS = 75_000;
/** Kp at or above this shows the GPS warning line. Matches the preflight caution default. */
const KP_ELEVATED = 5;
const MAX_STATUS_LENGTH = 128;
/** Used when CERTA_PREFLIGHT_AIRPORTS is empty. */
export const FALLBACK_STATUS_AIRPORT = 'KDEN';

const plural = (n: number, one: string, many: string) =>
  `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`;
const hours = (minutes: number) => `${(minutes / 60).toFixed(minutes < 600 ? 1 : 0)} h`;

/** The rotation, in order. A line returning null is skipped for that pass. */
export const STATUS_LINES: readonly ((s: PresenceStats) => string | null)[] = [
  () => '🛩️ On station for The Arkhon Pilot Network',
  ({ wx }) => {
    if (!wx) return null;
    const wind =
      wx.windKt === null
        ? ''
        : wx.windKt === 0
          ? ' · winds calm'
          : ` · wind ${wx.windKt}${wx.gustKt ? `G${wx.gustKt}` : ''} kt`;
    return wx.level === 'GO'
      ? `🟢 ${wx.icao} GO${wind} · /preflight`
      : `🟡 ${wx.icao} CAUTION${wx.reason ? ` · ${wx.reason}` : wind} · /preflight`;
  },
  ({ flightsThisMonth, month }) =>
    flightsThisMonth === null
      ? null
      : flightsThisMonth === 0
        ? `📒 First flight of ${month} is up for grabs · /log`
        : `📒 ${plural(flightsThisMonth, 'flight', 'flights')} logged in ${month} · /log yours`,
  ({ kp }) =>
    kp === null
      ? null
      : kp >= KP_ELEVATED
        ? `⚠️ Kp ${formatKp(kp)} · geomagnetic storm, GPS may wander`
        : `🛰️ Kp ${formatKp(kp)} · GPS skies quiet`,
  ({ leader, month }) =>
    leader ? `🏆 ${leader.name} leads ${month} with ${hours(leader.minutes)} · /leaderboard` : null,
  () => '🧭 Part 107 current? Check with /currency',
  ({ linkedPilots }) =>
    linkedPilots
      ? `👨‍✈️ ${plural(linkedPilots, 'pilot', 'pilots')} linked · /certa link to join`
      : null,
];

/**
 * The presence for rotation step `step`: the first line at or after it that has data.
 * Returns the presence and the step after the one used.
 */
export function presenceFor(
  step: number,
  stats: PresenceStats,
): { presence: PresenceData; next: number } {
  const n = STATUS_LINES.length;
  for (let i = 0; i < n; i++) {
    const index = (((step + i) % n) + n) % n;
    const state = STATUS_LINES[index]!(stats);
    if (state) {
      return {
        presence: {
          status: 'online',
          activities: [
            {
              type: ActivityType.Custom,
              name: 'Custom Status',
              state: state.slice(0, MAX_STATUS_LENGTH),
            },
          ],
        },
        next: step + i + 1,
      };
    }
  }
  return { presence: { status: 'online', activities: [] }, next: step + 1 };
}

const settle = async <T>(p: Promise<T>): Promise<T | null> => p.catch(() => null);

async function readStats(ctx: CertaContext): Promise<PresenceStats> {
  const icao = ctx.config.preflightAirports[0] ?? FALLBACK_STATUS_AIRPORT;
  const [report, board, linkedPilots] = await Promise.all([
    settle(ctx.preflight.report(icao)),
    settle(ctx.certa.getLeaderboard('month', { limit: 50 })),
    settle(ctx.prisma.certaLink.count()),
  ]);
  const metar = report?.metar.ok ? report.metar.value : null;
  const kp = report?.kp.ok && report.kp.value ? report.kp.value.kp : null;
  return {
    wx:
      report && metar
        ? {
            icao: report.icao,
            level: report.assessment.level,
            windKt: metar.windSpeedKt,
            gustKt: metar.gustKt,
            reason: report.assessment.reasons[0]?.split(' (')[0] ?? null,
          }
        : null,
    kp,
    month: ctx.now().toFormat('LLLL'),
    flightsThisMonth: board ? board.reduce((sum, e) => sum + e.flightCount, 0) : null,
    leader: board?.[0] ? { name: board[0].displayName, minutes: board[0].totalMinutes } : null,
    linkedPilots,
  };
}

/** Sets the custom status now and rotates it every PRESENCE_ROTATE_MS. */
export function startPresenceRotation(client: Client<true>, ctx: CertaContext): () => void {
  let step = 0;
  const update = async () => {
    try {
      const { presence, next } = presenceFor(step, await readStats(ctx));
      step = next;
      client.user.setPresence(presence);
    } catch (error) {
      ctx.logger.warn({ err: error }, 'could not update presence');
    }
  };
  void update();
  const timer = setInterval(() => void update(), PRESENCE_ROTATE_MS);
  timer.unref();
  return () => clearInterval(timer);
}
