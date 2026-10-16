import { ConfigError } from '@arkhon/shared';
import { describe, expect, it } from 'vitest';
import { loadCertaConfig } from '../src/config.js';

const base = {
  CERTA_DISCORD_TOKEN: 'x'.repeat(72),
  CERTA_DISCORD_CLIENT_ID: '100000000000000003',
  DISCORD_GUILD_ID: '100000000000000002',
  DATABASE_URL: 'file:./test.db',
  CERTA_API_MODE: 'mock',
};

describe('Certa config', () => {
  it('loads a minimal mock-mode environment with defaults', () => {
    const config = loadCertaConfig(base);
    expect(config.api).toEqual({ mode: 'mock' });
    expect(config.discord.clientId).toBe('100000000000000003');
    expect(config.timezone).toBe('America/Denver');
    expect(config.preflightAirports).toEqual([]);
    expect(config.thresholds).toEqual({
      maxWindKt: 15,
      maxGustKt: 20,
      minVisibilitySm: 3,
      minCeilingFt: 1000,
      kpCaution: 5,
    });
    expect(config.healthPort).toBe(3001);
  });

  it('does not read the Ops bot token', () => {
    expect(() =>
      loadCertaConfig({ ...base, CERTA_DISCORD_TOKEN: undefined, DISCORD_TOKEN: 'y'.repeat(72) }),
    ).toThrow(/CERTA_DISCORD_TOKEN/);
  });

  it('requires the API settings in http mode', () => {
    expect(() => loadCertaConfig({ ...base, CERTA_API_MODE: 'http' })).toThrow(
      /CERTA_API_BASE_URL[\s\S]*CERTA_API_TOKEN/,
    );
    const config = loadCertaConfig({
      ...base,
      CERTA_API_MODE: 'http',
      CERTA_API_BASE_URL: 'https://api.example.com',
      CERTA_API_TOKEN: 'secret',
    });
    expect(config.api).toEqual({
      mode: 'http',
      baseUrl: 'https://api.example.com',
      token: 'secret',
    });
  });

  it('validates airports, times, time zone and the database choice', () => {
    expect(
      loadCertaConfig({ ...base, CERTA_PREFLIGHT_AIRPORTS: 'KDEN, KBJC' }).preflightAirports,
    ).toEqual(['KDEN', 'KBJC']);
    for (const bad of [
      { CERTA_PREFLIGHT_AIRPORTS: 'DEN' },
      { CERTA_REMINDER_TIME: '9am' },
      { CERTA_TIMEZONE: 'Mars/Olympus' },
      { D1_BRIDGE_URL: 'http://d1.internal' },
      { DATABASE_URL: undefined },
    ]) {
      expect(() => loadCertaConfig({ ...base, ...bad }), JSON.stringify(bad)).toThrow(ConfigError);
    }
  });
});
