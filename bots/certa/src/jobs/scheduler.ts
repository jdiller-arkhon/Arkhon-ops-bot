import type { Logger } from '@arkhon/shared';
import { DateTime } from 'luxon';

export type Schedule =
  /** Every day at `time` (HH:mm) in the scheduler's time zone. */
  | { kind: 'daily'; time: string }
  /** On `day` of each month at `time` (HH:mm). Day must be 1-28. */
  | { kind: 'monthly'; day: number; time: string };

export interface ScheduledJob {
  name: string;
  schedule: Schedule;
  run: (context: { runKey: string; now: DateTime }) => Promise<void>;
}

export interface JobRunStore {
  /** Resolves true if the run was claimed, false if it already happened. */
  claim(job: string, runKey: string): Promise<boolean>;
  /** Releases a claim so a failed run is retried later. */
  release(job: string, runKey: string): Promise<void>;
}

function parseTime(time: string): { hour: number; minute: number } {
  const [hour, minute] = time.split(':').map(Number);
  if (hour === undefined || minute === undefined || Number.isNaN(hour) || Number.isNaN(minute)) {
    throw new Error(`Invalid schedule time "${time}"`);
  }
  return { hour, minute };
}

/**
 * The run key for the occurrence of `schedule` due at `now`, or null if nothing is due. An
 * occurrence stays due for the rest of its day after its start time, so a bot restarted late
 * (deploy, crash) still runs it once.
 */
export function dueRunKey(schedule: Schedule, now: DateTime): string | null {
  const { hour, minute } = parseTime(schedule.time);
  const start = now.set({ hour, minute, second: 0, millisecond: 0 });
  if (now < start) return null;
  if (schedule.kind === 'daily') return now.toISODate();
  if (now.day !== schedule.day) return null;
  return now.toFormat('yyyy-LL');
}

export interface SchedulerOptions {
  timezone: string;
  store: JobRunStore;
  logger: Logger;
  /** Tick interval. Default 30s. */
  intervalMs?: number;
  /** Minimum wait before retrying a failed run. Default 10 minutes. */
  retryDelayMs?: number;
  now?: () => DateTime;
}

/**
 * Minute-resolution job scheduler. Each tick checks every job; a due run is claimed in the store
 * first, so it happens at most once per occurrence even across restarts. A failed run is released
 * and retried after `retryDelayMs`. Returns a function that stops the scheduler.
 */
export function startScheduler(
  jobs: readonly ScheduledJob[],
  options: SchedulerOptions,
): () => void {
  const now = options.now ?? (() => DateTime.now().setZone(options.timezone));
  const running = new Set<string>();
  const lastFailure = new Map<string, number>();
  const retryDelayMs = options.retryDelayMs ?? 10 * 60_000;

  for (const job of jobs) {
    if (job.schedule.kind === 'monthly' && (job.schedule.day < 1 || job.schedule.day > 28)) {
      throw new Error(`Job ${job.name}: monthly day must be 1-28`);
    }
    parseTime(job.schedule.time);
  }

  const runJob = async (job: ScheduledJob, current: DateTime): Promise<void> => {
    const failedAt = lastFailure.get(job.name);
    if (failedAt !== undefined && current.toMillis() - failedAt < retryDelayMs) return;
    const runKey = dueRunKey(job.schedule, current);
    if (!runKey || !(await options.store.claim(job.name, runKey))) return;

    options.logger.info({ job: job.name, runKey }, 'scheduled job started');
    try {
      await job.run({ runKey, now: current });
      lastFailure.delete(job.name);
      options.logger.info({ job: job.name, runKey }, 'scheduled job finished');
    } catch (error) {
      options.logger.error({ err: error, job: job.name, runKey }, 'scheduled job failed');
      lastFailure.set(job.name, current.toMillis());
      await options.store.release(job.name, runKey);
    }
  };

  const tick = () => {
    const current = now();
    for (const job of jobs) {
      if (running.has(job.name)) continue;
      running.add(job.name);
      runJob(job, current)
        .catch((error: unknown) =>
          options.logger.error({ err: error, job: job.name }, 'scheduler could not run job'),
        )
        .finally(() => running.delete(job.name));
    }
  };

  tick();
  const timer = setInterval(tick, options.intervalMs ?? 30_000);
  timer.unref();
  return () => clearInterval(timer);
}
