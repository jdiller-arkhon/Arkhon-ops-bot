import { isUniqueViolation } from '@arkhon/shared';
import type { PrismaClient } from '@prisma/client';
import type { MissionType } from './certa/types.js';
import type { JobRunStore } from './jobs/scheduler.js';

export interface Link {
  discordUserId: string;
  certaUserId: string;
  displayName: string;
  remindersEnabled: boolean;
}

export interface SharedFlight {
  flightId: string;
  discordUserId: string;
  date: string;
  publicLocation: string;
  aircraft: string;
  durationMinutes: number;
  missionType: MissionType;
  sharedAt: Date | null;
}

/** What the reminder job needs; tests pass an in-memory version. */
export interface ReminderStore {
  listRemindable(): Promise<Link[]>;
  sentReminderThresholds(discordUserId: string, dueDate: string): Promise<number[]>;
  recordRemindersSent(discordUserId: string, dueDate: string, thresholds: number[]): Promise<void>;
}

/**
 * The bot's own tables (certa_*). D1 has no transactions, so multi-step changes are ordered so a
 * partial failure leaves nothing a retry cannot fix.
 */
export class CertaStore implements ReminderStore, JobRunStore {
  constructor(readonly prisma: PrismaClient) {}

  getLink(discordUserId: string): Promise<Link | null> {
    return this.prisma.certaLink.findUnique({ where: { discordUserId } });
  }

  /** A Certa account links to one Discord account: an older link to it is replaced. */
  async upsertLink(discordUserId: string, certaUserId: string, displayName: string): Promise<void> {
    await this.prisma.certaLink.deleteMany({
      where: { certaUserId, NOT: { discordUserId } },
    });
    await this.prisma.certaLink.upsert({
      where: { discordUserId },
      create: { discordUserId, certaUserId, displayName },
      update: { certaUserId, displayName, linkedAt: new Date() },
    });
  }

  /** Removes the link, its reminder history and unshared flight summaries. */
  async deleteLink(discordUserId: string): Promise<boolean> {
    const { count } = await this.prisma.certaLink.deleteMany({ where: { discordUserId } });
    await this.prisma.certaReminderSend.deleteMany({ where: { discordUserId } });
    await this.prisma.certaSharedFlight.deleteMany({ where: { discordUserId, sharedAt: null } });
    return count > 0;
  }

  async setRemindersEnabled(discordUserId: string, enabled: boolean): Promise<boolean> {
    const { count } = await this.prisma.certaLink.updateMany({
      where: { discordUserId },
      data: { remindersEnabled: enabled },
    });
    return count > 0;
  }

  listRemindable(): Promise<Link[]> {
    return this.prisma.certaLink.findMany({
      where: { remindersEnabled: true },
      orderBy: { linkedAt: 'asc' },
    });
  }

  /** Certa user id -> Discord user id for every linked pilot (leaderboard mentions). */
  async discordIdsByCertaId(): Promise<Map<string, string>> {
    const rows = await this.prisma.certaLink.findMany({
      select: { certaUserId: true, discordUserId: true },
    });
    return new Map(rows.map((row) => [row.certaUserId, row.discordUserId]));
  }

  async sentReminderThresholds(discordUserId: string, dueDate: string): Promise<number[]> {
    const rows = await this.prisma.certaReminderSend.findMany({
      where: { discordUserId, dueDate },
      select: { thresholdDays: true },
    });
    return rows.map((row) => row.thresholdDays);
  }

  async recordRemindersSent(
    discordUserId: string,
    dueDate: string,
    thresholds: number[],
  ): Promise<void> {
    for (const thresholdDays of thresholds) {
      await this.prisma.certaReminderSend.upsert({
        where: { discordUserId_dueDate_thresholdDays: { discordUserId, dueDate, thresholdDays } },
        create: { discordUserId, dueDate, thresholdDays },
        update: {},
      });
    }
  }

  async saveSharedFlight(flight: Omit<SharedFlight, 'sharedAt'>): Promise<void> {
    await this.prisma.certaSharedFlight.upsert({
      where: { flightId: flight.flightId },
      create: flight,
      update: flight,
    });
  }

  async getSharedFlight(flightId: string): Promise<SharedFlight | null> {
    const row = await this.prisma.certaSharedFlight.findUnique({ where: { flightId } });
    return row ? { ...row, missionType: row.missionType as MissionType } : null;
  }

  /** Claims the share; false when it was already shared (double click, second device). */
  async markShared(flightId: string): Promise<boolean> {
    const { count } = await this.prisma.certaSharedFlight.updateMany({
      where: { flightId, sharedAt: null },
      data: { sharedAt: new Date() },
    });
    return count > 0;
  }

  /** Reverts markShared when posting failed, so the pilot can try again. */
  async unmarkShared(flightId: string): Promise<void> {
    await this.prisma.certaSharedFlight.updateMany({
      where: { flightId },
      data: { sharedAt: null },
    });
  }

  /** Drops unshared summaries older than `days`. */
  async pruneSharedFlights(days: number, now: Date = new Date()): Promise<void> {
    await this.prisma.certaSharedFlight.deleteMany({
      where: { sharedAt: null, createdAt: { lt: new Date(now.getTime() - days * 86_400_000) } },
    });
  }

  async claim(job: string, runKey: string): Promise<boolean> {
    try {
      await this.prisma.certaJobRun.create({ data: { job, runKey } });
      return true;
    } catch (error) {
      if (isUniqueViolation(error)) return false;
      throw error;
    }
  }

  async release(job: string, runKey: string): Promise<void> {
    await this.prisma.certaJobRun.deleteMany({ where: { job, runKey } });
  }
}
