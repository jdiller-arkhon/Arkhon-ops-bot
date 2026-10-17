import { describe, expect, it } from 'vitest';
import type { FleetAircraft, FleetBattery } from '../src/certa/types.js';
import type { CurrencySummary } from '../src/domain/currency.js';
import { lightPeriod, sunTimes } from '../src/domain/daylight.js';
import {
  aircraftCheck,
  batteriesFor,
  batteryCheck,
  decide,
  pickAircraft,
  pilotCheck,
} from '../src/domain/fleet.js';
import { mockFleet } from '../src/domain/mock-fleet.js';

const TODAY = '2026-10-17';
const ac = (over: Partial<FleetAircraft> = {}): FleetAircraft => ({
  id: 'a1',
  name: 'Hawkeye',
  makeModel: 'DJI Mavic 3 Enterprise',
  status: 'active',
  groundedReason: null,
  registrationExpiresOn: '2028-01-01',
  maintenanceDueOn: '2026-12-01',
  totalFlights: 10,
  totalMinutes: 300,
  ...over,
});
const bat = (over: Partial<FleetBattery> = {}): FleetBattery => ({
  id: 'b1',
  label: 'Mavic 3 #1',
  status: 'active',
  cycleCount: 50,
  maxCycles: 200,
  aircraftModel: 'Mavic 3',
  ...over,
});
const currency = (
  state: CurrencySummary['state'],
  daysRemaining: number | null = 400,
): CurrencySummary => ({
  state,
  lastTrainingDate: '2025-06-01',
  lastTrainingKind: 'recurrent',
  dueDate: '2027-06-30',
  daysRemaining,
});

describe('aircraft check', () => {
  it('is green when registered and maintained', () => {
    expect(aircraftCheck(ac(), TODAY).level).toBe('green');
  });
  it('flags grounded, expired and missing registration red', () => {
    expect(
      aircraftCheck(ac({ status: 'grounded', groundedReason: 'Prop damage' }), TODAY),
    ).toMatchObject({
      level: 'red',
      detail: 'Grounded: Prop damage',
    });
    expect(aircraftCheck(ac({ registrationExpiresOn: '2026-10-01' }), TODAY).level).toBe('red');
    expect(aircraftCheck(ac({ registrationExpiresOn: null }), TODAY).level).toBe('red');
    expect(aircraftCheck(ac({ maintenanceDueOn: '2026-10-10' }), TODAY).detail).toBe(
      'Maintenance overdue by 7 days',
    );
  });
  it('warns amber when registration or maintenance is close', () => {
    expect(aircraftCheck(ac({ registrationExpiresOn: '2026-11-01' }), TODAY).detail).toBe(
      'Registration expires in 15 days',
    );
    expect(aircraftCheck(ac({ maintenanceDueOn: '2026-10-20' }), TODAY).level).toBe('amber');
  });
});

describe('battery check', () => {
  it('uses Certa cycle thresholds', () => {
    expect(batteryCheck(bat()).level).toBe('green');
    expect(batteryCheck(bat({ cycleCount: 185 })).level).toBe('amber');
    expect(batteryCheck(bat({ cycleCount: 200 })).level).toBe('red');
    expect(batteryCheck(bat({ status: 'watch', cycleCount: 10 })).level).toBe('amber');
  });
  it('matches batteries to aircraft by model', () => {
    const list = [bat(), bat({ id: 'b2', aircraftModel: 'X10' })];
    expect(batteriesFor(ac(), list).map((b) => b.id)).toEqual(['b1']);
  });
});

describe('decision', () => {
  it('takes the worst level', () => {
    expect(decide([pilotCheck('P', currency('current')), aircraftCheck(ac(), TODAY)])).toBe('GO');
    expect(decide([pilotCheck('P', currency('due-soon', 30))])).toBe('CAUTION');
    expect(decide([pilotCheck('P', currency('lapsed', -3)), batteryCheck(bat())])).toBe('NO-GO');
  });
});

describe('pickAircraft', () => {
  const fleet = [ac(), ac({ id: 'a2', name: 'Ghost', makeModel: 'Skydio X10' })];
  it('finds by id, name or model', () => {
    expect(pickAircraft(fleet, 'a2')?.name).toBe('Ghost');
    expect(pickAircraft(fleet, 'hawk')?.id).toBe('a1');
    expect(pickAircraft(fleet, 'skydio')?.id).toBe('a2');
    expect(pickAircraft(fleet, 'nope')).toBeNull();
  });
  it('defaults only when there is one aircraft', () => {
    expect(pickAircraft(fleet, null)).toBeNull();
    expect(pickAircraft([ac()], null)?.id).toBe('a1');
  });
});

describe('mock fleet', () => {
  it('is stable per pilot and shows every state', () => {
    const f = mockFleet('mock-123', TODAY);
    expect(mockFleet('mock-123', TODAY)).toEqual(f);
    expect(f.aircraft).toHaveLength(2);
    expect(f.batteries.some((b) => b.status === 'watch')).toBe(true);
    expect(aircraftCheck(f.aircraft[1]!, TODAY).level).toBe('amber');
    for (const a of f.aircraft) expect(batteriesFor(a, f.batteries).length).toBeGreaterThan(0);
  });
});

describe('daylight', () => {
  // Denver, 2026-06-21: sunrise ~11:32Z, sunset ~02:31Z next day (USNO).
  const t = sunTimes(new Date('2026-06-21T18:00:00Z'), 39.86, -104.67);
  it('matches published sunrise and sunset within a few minutes', () => {
    expect(Math.abs(t.sunrise!.getTime() - Date.parse('2026-06-21T11:32:00Z'))).toBeLessThan(
      5 * 60_000,
    );
    expect(Math.abs(t.sunset!.getTime() - Date.parse('2026-06-22T02:31:00Z'))).toBeLessThan(
      5 * 60_000,
    );
    expect(t.civilDawn!.getTime()).toBeLessThan(t.sunrise!.getTime());
    expect(t.civilDusk!.getTime()).toBeGreaterThan(t.sunset!.getTime());
  });
  it('classifies day, twilight and night', () => {
    expect(lightPeriod(new Date('2026-06-21T18:00:00Z'), t)).toBe('day');
    expect(lightPeriod(new Date(t.sunset!.getTime() + 10 * 60_000), t)).toBe('civil-twilight');
    expect(lightPeriod(new Date('2026-06-22T05:00:00Z'), t)).toBe('night');
  });
});
