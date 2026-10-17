import { randomUUID } from 'node:crypto';
import { isUniqueViolation } from '@arkhon/shared';
import type { PrismaClient } from '@prisma/client';
import { DateTime } from 'luxon';
import { mockFleet } from '../domain/mock-fleet.js';
import { computeTotals, rankLeaderboard } from '../domain/mock-math.js';
import { type CertaClient, CertaInvalidLinkCodeError, CertaUserNotFoundError } from './client.js';
import {
  flightInputSchema,
  type CurrencyStatus,
  type Fleet,
  type FlightInput,
  type FlightTotals,
  type LeaderboardEntry,
  type LeaderboardOptions,
  type LeaderboardPeriod,
  type LinkResult,
  type LogFlightResult,
} from './types.js';

export interface MockCertaClientOptions {
  timezone: string;
  now?: () => DateTime;
  /**
   * Calendar months before "now" that new mock pilots last completed recurrent training. The
   * default of 23 puts them inside the 60-day reminder window so reminders show up right away.
   */
  seedTrainingMonthsAgo?: number;
}

/**
 * CertaClient backed by the bot's database (certa_mock_* tables), so every command works before
 * the Certa API ships (CERTA_API_MODE=mock). Any well-formed link code works once; the Certa user
 * id is stable per Discord user, so unlinking and relinking keeps logged flights.
 */
export class MockCertaClient implements CertaClient {
  private readonly now: () => DateTime;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly options: MockCertaClientOptions,
  ) {
    this.now = options.now ?? (() => DateTime.now().setZone(options.timezone));
  }

  async redeemLinkCode(code: string, discordUserId: string): Promise<LinkResult> {
    const normalized = code.trim().toUpperCase();
    const certaUserId = `mock-${discordUserId}`;
    const trainingDate = this.now()
      .minus({ months: this.options.seedTrainingMonthsAgo ?? 23 })
      .toISODate();
    const user = await this.prisma.certaMockUser.upsert({
      where: { certaUserId },
      create: {
        certaUserId,
        displayName: `Pilot ${discordUserId.slice(-4)}`,
        lastTrainingDate: trainingDate,
        lastTrainingKind: 'recurrent',
      },
      update: {},
    });
    try {
      await this.prisma.certaMockLinkCode.create({
        data: { code: normalized, certaUserId, discordUserId },
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new CertaInvalidLinkCodeError('Link code has already been used');
      }
      throw error;
    }
    return { certaUserId, displayName: user.displayName };
  }

  async logFlight(certaUserId: string, flight: FlightInput): Promise<LogFlightResult> {
    await this.requireUser(certaUserId);
    const valid = flightInputSchema.parse(flight);
    const flightId = `mock-flt-${randomUUID()}`;
    await this.prisma.certaMockFlight.create({
      data: {
        flightId,
        certaUserId,
        date: valid.date,
        location: valid.location,
        locationIsIcao: valid.locationIsIcao,
        aircraft: valid.aircraft,
        durationMinutes: valid.durationMinutes,
        missionType: valid.missionType,
        notes: valid.notes ?? null,
      },
    });
    return { flightId };
  }

  async getTotals(certaUserId: string): Promise<FlightTotals> {
    await this.requireUser(certaUserId);
    const rows = await this.prisma.certaMockFlight.findMany({
      where: { certaUserId },
      select: { date: true, durationMinutes: true },
    });
    return computeTotals(rows, this.now().toISODate()!);
  }

  async getCurrency(certaUserId: string): Promise<CurrencyStatus> {
    const user = await this.requireUser(certaUserId);
    const kind = user.lastTrainingKind;
    return {
      lastTrainingDate: user.lastTrainingDate,
      lastTrainingKind: kind === 'initial' || kind === 'recurrent' ? kind : null,
    };
  }

  async getFleet(certaUserId: string): Promise<Fleet> {
    await this.requireUser(certaUserId);
    return mockFleet(certaUserId, this.now().toISODate()!);
  }

  async getLeaderboard(
    period: LeaderboardPeriod,
    options: LeaderboardOptions = {},
  ): Promise<LeaderboardEntry[]> {
    const month =
      period === 'month' ? (options.month ?? this.now().toFormat('yyyy-LL')) : undefined;
    const [rows, users] = await Promise.all([
      this.prisma.certaMockFlight.findMany({
        where: month ? { date: { startsWith: `${month}-` } } : {},
        select: { certaUserId: true, date: true, durationMinutes: true },
      }),
      this.prisma.certaMockUser.findMany({ select: { certaUserId: true, displayName: true } }),
    ]);
    const names = new Map(users.map((u) => [u.certaUserId, u.displayName]));
    return rankLeaderboard(rows, names, { month, limit: options.limit ?? 10 });
  }

  private async requireUser(certaUserId: string) {
    const user = await this.prisma.certaMockUser.findUnique({ where: { certaUserId } });
    if (!user) throw new CertaUserNotFoundError(`Mock Certa user ${certaUserId} not found`);
    return user;
  }
}
