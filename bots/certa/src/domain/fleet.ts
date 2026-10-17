import type { FleetAircraft, FleetBattery, Verification } from '../certa/types.js';
import type { CurrencySummary } from './currency.js';
import { daysUntil } from './currency.js';
import type { LightPeriod } from './daylight.js';

export type Level = 'green' | 'amber' | 'red';

export interface Check {
  label: string;
  level: Level;
  detail: string;
}

/** Days ahead that an expiring registration or due maintenance turns amber. Matches Certa. */
export const DUE_SOON_DAYS = 30;
/** Fraction of a battery's cycle limit that turns it amber. Matches Certa's go/no-go. */
const BATTERY_WATCH_FRACTION = 0.9;

const LEVEL_ORDER: Record<Level, number> = { green: 0, amber: 1, red: 2 };
export const worst = (levels: Level[]): Level =>
  levels.reduce<Level>((w, l) => (LEVEL_ORDER[l] > LEVEL_ORDER[w] ? l : w), 'green');

/** Batteries that fit an aircraft (by model), active ones first. */
export function batteriesFor(aircraft: FleetAircraft, batteries: FleetBattery[]): FleetBattery[] {
  const model = aircraft.makeModel.toLowerCase();
  return batteries
    .filter((b) => b.aircraftModel && model.includes(b.aircraftModel.toLowerCase()))
    .sort((a, b) => Number(a.status === 'retired') - Number(b.status === 'retired'));
}

export function aircraftCheck(a: FleetAircraft, today: string): Check {
  const label = `Aircraft · ${a.name}`;
  if (a.status === 'retired') return { label, level: 'red', detail: 'Retired' };
  if (a.status === 'grounded') {
    return {
      label,
      level: 'red',
      detail: `Grounded${a.groundedReason ? `: ${a.groundedReason}` : ''}`,
    };
  }
  const reg = a.registrationExpiresOn ? daysUntil(a.registrationExpiresOn, today) : null;
  const mx = a.maintenanceDueOn ? daysUntil(a.maintenanceDueOn, today) : null;
  if (reg === null) return { label, level: 'red', detail: 'No FAA registration on file' };
  if (reg < 0) return { label, level: 'red', detail: 'FAA registration expired' };
  if (mx !== null && mx < 0)
    return { label, level: 'red', detail: `Maintenance overdue by ${-mx} days` };
  if (reg <= DUE_SOON_DAYS)
    return { label, level: 'amber', detail: `Registration expires in ${reg} days` };
  if (mx !== null && mx <= 7)
    return { label, level: 'amber', detail: `Maintenance due in ${mx} days` };
  return { label, level: 'green', detail: 'Registered, airworthy, maintenance current' };
}

export function batteryCheck(b: FleetBattery): Check {
  const label = `Battery · ${b.label}`;
  const frac = b.maxCycles ? b.cycleCount / b.maxCycles : 0;
  const cycles = b.maxCycles
    ? `${b.cycleCount} of ${b.maxCycles} cycles`
    : `${b.cycleCount} cycles`;
  if (b.status === 'retired' || frac >= 1)
    return { label, level: 'red', detail: `Retire · ${cycles}` };
  if (b.status === 'watch' || frac >= BATTERY_WATCH_FRACTION) {
    return { label, level: 'amber', detail: `Near end of life · ${cycles}` };
  }
  return { label, level: 'green', detail: cycles };
}

export function pilotCheck(name: string, c: CurrencySummary): Check {
  const label = `Pilot · ${name}`;
  switch (c.state) {
    case 'unknown':
      return { label, level: 'red', detail: 'No Part 107 training on file' };
    case 'lapsed':
      return { label, level: 'red', detail: 'Recurrent training lapsed' };
    case 'due-soon':
      return {
        label,
        level: 'amber',
        detail: `Current · recurrent due in ${c.daysRemaining} days`,
      };
    default:
      return { label, level: 'green', detail: 'Part 107 current' };
  }
}

export function lightCheck(period: LightPeriod): Check {
  if (period === 'day') return { label: 'Daylight', level: 'green', detail: 'Daylight now' };
  if (period === 'civil-twilight') {
    return {
      label: 'Daylight',
      level: 'amber',
      detail: 'Civil twilight: anti-collision lights visible 3 SM',
    };
  }
  return {
    label: 'Daylight',
    level: 'amber',
    detail: 'Night: anti-collision lights and night-qualified training required',
  };
}

export type Decision = 'GO' | 'CAUTION' | 'NO-GO';

export function decide(checks: Check[]): Decision {
  const w = worst(checks.map((c) => c.level));
  return w === 'red' ? 'NO-GO' : w === 'amber' ? 'CAUTION' : 'GO';
}

/** Find an aircraft by name, make/model or id (case-insensitive); the only active one if blank. */
export function pickAircraft(fleet: FleetAircraft[], query: string | null): FleetAircraft | null {
  const flying = fleet.filter((a) => a.status !== 'retired');
  if (!query) return flying.length === 1 ? flying[0]! : null;
  const q = query.trim().toLowerCase();
  return (
    fleet.find((a) => a.id === query) ??
    fleet.find((a) => a.name.toLowerCase() === q) ??
    fleet.find((a) => a.name.toLowerCase().includes(q) || a.makeModel.toLowerCase().includes(q)) ??
    null
  );
}

/** Certa-style verification of one aircraft from fleet records (used by the mock backend). */
export function verifyAircraft(a: FleetAircraft, today: string): Verification {
  const check = aircraftCheck(a, today);
  return {
    subject: {
      type: 'aircraft',
      name: `${a.name} (${a.makeModel})`,
      identifier: a.registrationNumber,
    },
    legalToFly: check.level !== 'red',
    status: check.level,
    reasons:
      check.level === 'green' ? [] : [{ level: check.level, text: check.detail, dueOn: null }],
    asOf: today,
    ruleSet: 'FAA Part 107 (mock)',
    notice:
      'Computed from records entered by the operator. Advisory only: the remote pilot in command remains responsible for compliance.',
  };
}
