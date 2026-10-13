/**
 * Alt and raid shield. Pure, in-memory logic; the Discord side lives in service.ts.
 *
 * - Account age: Discord accounts younger than the configured minimum cannot verify. Alt and
 *   raid accounts are almost always freshly created.
 * - Attempt limiter: a sliding window of verification attempts per Discord user.
 * - Raid detector: counts joins in a sliding window; crossing the threshold starts a lockdown
 *   during which nobody new can verify and server invites are paused.
 * One member ID per Discord account (and vice versa) is enforced by the website and the
 * ops_member_links unique constraints.
 */
const DAY_MS = 86_400_000;
const DISCORD_EPOCH = 1_420_070_400_000n;

/** Account creation time from a Discord snowflake. */
export function snowflakeTimestamp(id: string): number {
  return Number((BigInt(id) >> 22n) + DISCORD_EPOCH);
}

export function accountAgeDays(discordUserId: string, now: number = Date.now()): number {
  return (now - snowflakeTimestamp(discordUserId)) / DAY_MS;
}

export function isAccountOldEnough(
  discordUserId: string,
  minDays: number,
  now: number = Date.now(),
): boolean {
  return minDays <= 0 || accountAgeDays(discordUserId, now) >= minDays;
}

/** Sliding-window counter keyed by user. */
export class AttemptLimiter {
  private readonly attempts = new Map<string, number[]>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
  ) {}

  /** Records an attempt; returns false (and does not record) when the user is over the limit. */
  tryConsume(key: string, now: number = Date.now()): boolean {
    const recent = (this.attempts.get(key) ?? []).filter((t) => now - t < this.windowMs);
    if (recent.length >= this.limit) {
      this.attempts.set(key, recent);
      return false;
    }
    recent.push(now);
    this.attempts.set(key, recent);
    return true;
  }

  /** Milliseconds until the user may try again (0 when allowed now). */
  retryAfterMs(key: string, now: number = Date.now()): number {
    const recent = (this.attempts.get(key) ?? []).filter((t) => now - t < this.windowMs);
    if (recent.length < this.limit) return 0;
    return this.windowMs - (now - (recent[0] as number));
  }

  reset(key: string): void {
    this.attempts.delete(key);
  }

  /** Drops users whose window is empty, so the map does not grow forever. */
  prune(now: number = Date.now()): void {
    for (const [key, times] of this.attempts) {
      if (times.every((t) => now - t >= this.windowMs)) this.attempts.delete(key);
    }
  }
}

export interface LockdownState {
  active: boolean;
  until?: number;
  reason?: string;
}

/** Join-spike detector with a lockdown that expires on its own. */
export class RaidShield {
  private joins: number[] = [];
  private lockdownUntil = 0;
  private lockdownReason: string | undefined;

  constructor(
    private readonly threshold: number,
    private readonly windowMs: number,
    private readonly lockdownMs: number,
  ) {}

  /**
   * Records a join. Returns true exactly when this join starts a new lockdown.
   */
  recordJoin(now: number = Date.now()): boolean {
    this.joins = this.joins.filter((t) => now - t < this.windowMs);
    this.joins.push(now);
    if (this.isLocked(now) || this.joins.length < this.threshold) return false;
    this.start(`${this.joins.length} joins in ${Math.round(this.windowMs / 1000)}s`, now);
    return true;
  }

  start(reason: string, now: number = Date.now(), durationMs: number = this.lockdownMs): number {
    this.lockdownUntil = now + durationMs;
    this.lockdownReason = reason;
    return this.lockdownUntil;
  }

  stop(): void {
    this.lockdownUntil = 0;
    this.lockdownReason = undefined;
    this.joins = [];
  }

  isLocked(now: number = Date.now()): boolean {
    return now < this.lockdownUntil;
  }

  state(now: number = Date.now()): LockdownState {
    return this.isLocked(now)
      ? {
          active: true,
          until: this.lockdownUntil,
          ...(this.lockdownReason ? { reason: this.lockdownReason } : {}),
        }
      : { active: false };
  }

  recentJoins(now: number = Date.now()): number {
    return this.joins.filter((t) => now - t < this.windowMs).length;
  }
}
