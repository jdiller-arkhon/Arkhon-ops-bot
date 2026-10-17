import { z } from 'zod';

/** `YYYY-MM-DD` calendar date. */
export const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD');

export const MISSION_TYPES = [
  'Commercial',
  'Recreational',
  'Training',
  'Inspection',
  'Mapping',
  'Cinematography',
  'Other',
] as const;
export const missionTypeSchema = z.enum(MISSION_TYPES);
export type MissionType = z.infer<typeof missionTypeSchema>;

export const flightInputSchema = z.object({
  /** Local calendar date of the flight. */
  date: isoDate,
  /** Free text (city, site name) or a 4-character ICAO code. */
  location: z.string().trim().min(1).max(100),
  /** True when `location` is an ICAO airport identifier. */
  locationIsIcao: z.boolean(),
  aircraft: z.string().trim().min(1).max(80),
  durationMinutes: z.number().int().min(1).max(1440),
  missionType: missionTypeSchema,
  notes: z.string().trim().max(1000).optional(),
});
export type FlightInput = z.infer<typeof flightInputSchema>;

// Response schemas use zod's default "strip" behaviour: unknown keys (for
// example a certificate number added by the backend) are dropped and never
// reach the bot's storage.

export const linkResultSchema = z.object({
  certaUserId: z.string().min(1),
  displayName: z.string().min(1),
});
export type LinkResult = z.infer<typeof linkResultSchema>;

export const logFlightResultSchema = z.object({
  flightId: z.string().min(1),
});
export type LogFlightResult = z.infer<typeof logFlightResultSchema>;

const periodTotalsSchema = z.object({
  flights: z.number().int().nonnegative(),
  minutes: z.number().int().nonnegative(),
});
export type PeriodTotals = z.infer<typeof periodTotalsSchema>;

export const flightTotalsSchema = z.object({
  totalFlights: z.number().int().nonnegative(),
  totalMinutes: z.number().int().nonnegative(),
  last30Days: periodTotalsSchema,
  last90Days: periodTotalsSchema,
  last365Days: periodTotalsSchema,
});
export type FlightTotals = z.infer<typeof flightTotalsSchema>;

/**
 * Part 107 training history. The bot computes the recurrent due date itself
 * (24 calendar months after the most recent qualifying event).
 */
export const currencyStatusSchema = z.object({
  /** Date of the most recent initial knowledge test or recurrent training, or null if none on file. */
  lastTrainingDate: isoDate.nullable(),
  lastTrainingKind: z.enum(['initial', 'recurrent']).nullable(),
});
export type CurrencyStatus = z.infer<typeof currencyStatusSchema>;

export const leaderboardEntrySchema = z.object({
  rank: z.number().int().positive(),
  certaUserId: z.string().min(1),
  displayName: z.string().min(1),
  totalMinutes: z.number().int().nonnegative(),
  flightCount: z.number().int().nonnegative(),
});
export type LeaderboardEntry = z.infer<typeof leaderboardEntrySchema>;

export const leaderboardResponseSchema = z.object({
  entries: z.array(leaderboardEntrySchema),
});

export type LeaderboardPeriod = 'month' | 'all';

export interface LeaderboardOptions {
  /**
   * Calendar month (`YYYY-MM`) for `period: 'month'`. Defaults to the current
   * month. Used by the monthly job to post the month that just ended.
   */
  month?: string;
  limit?: number;
}

/** Aircraft as Certa tracks it (subset the bot shows). Mirrors Certa's Aircraft entity. */
export const fleetAircraftSchema = z.object({
  id: z.string().min(1),
  /** Display name: nickname, or make and model. */
  name: z.string().min(1),
  makeModel: z.string().min(1),
  status: z.enum(['active', 'grounded', 'retired']),
  groundedReason: z.string().nullable(),
  /** FAA registration number, e.g. FA3XXXXXXX. */
  registrationNumber: z.string().nullable(),
  serialNumber: z.string().min(1),
  registrationExpiresOn: isoDate.nullable(),
  /** Next scheduled maintenance, or null if none is scheduled. */
  maintenanceDueOn: isoDate.nullable(),
  totalFlights: z.number().int().nonnegative(),
  totalMinutes: z.number().int().nonnegative(),
});
export type FleetAircraft = z.infer<typeof fleetAircraftSchema>;

export const fleetBatterySchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  status: z.enum(['active', 'watch', 'retired']),
  cycleCount: z.number().int().nonnegative(),
  /** Retirement threshold in cycles, or null if none is set. */
  maxCycles: z.number().int().positive().nullable(),
  /** Aircraft model it fits, for matching batteries to an aircraft. */
  aircraftModel: z.string().nullable(),
});
export type FleetBattery = z.infer<typeof fleetBatterySchema>;

export const fleetSchema = z.object({
  aircraft: z.array(fleetAircraftSchema),
  batteries: z.array(fleetBatterySchema),
});
export type Fleet = z.infer<typeof fleetSchema>;

/** What to look up. Exactly one is set. */
export type VerifyQuery =
  | { kind: 'certificateNumber'; value: string }
  | { kind: 'registration'; value: string }
  | { kind: 'serialNumber'; value: string };

const levelSchema = z.enum(['green', 'amber', 'red']);

/**
 * Certa's verification answer (GET /api/v1/verify/lookup). For pilots, Certa's `identifier` is the
 * remote pilot certificate number: it is dropped here so it never reaches Discord or the bot's logs.
 */
export const verificationSchema = z
  .object({
    subject: z.object({
      type: z.enum(['pilot', 'aircraft']),
      name: z.string().min(1),
      identifier: z.string().nullable(),
    }),
    legalToFly: z.boolean(),
    status: levelSchema,
    reasons: z.array(
      z.object({ level: levelSchema, text: z.string(), dueOn: z.string().nullable() }),
    ),
    asOf: z.string(),
    ruleSet: z.string(),
    notice: z.string(),
  })
  .transform((v) => ({
    ...v,
    subject: { ...v.subject, identifier: v.subject.type === 'pilot' ? null : v.subject.identifier },
  }));
export type Verification = z.output<typeof verificationSchema>;
