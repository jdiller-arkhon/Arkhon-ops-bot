import { readFileSync } from 'node:fs';
import { createLogger } from '@arkhon/shared';
import { describe, expect, it } from 'vitest';
import { ADVISORY_NOTICE, buildPreflightEmbed, TFR_UNAVAILABLE } from '../src/preflight/embed.js';
import { PreflightService } from '../src/preflight/service.js';

const fixture = (name: string) =>
  readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
const thresholds = {
  maxWindKt: 15,
  maxGustKt: 20,
  minVisibilitySm: 3,
  minCeilingFt: 1000,
  kpCaution: 5,
};

function service(tfrBody: string) {
  const urls: string[] = [];
  const fetchFn = (async (url: string) => {
    urls.push(String(url));
    if (url.includes('/metar')) return new Response(fixture('metar-kden.json'));
    if (url.includes('/taf')) return new Response(fixture('taf-kden.json'));
    if (url.includes('k-index')) return new Response(fixture('kp-index.json'));
    return new Response(tfrBody);
  }) as unknown as typeof fetch;
  const svc = new PreflightService({
    thresholds,
    tfrRadiusNm: 30,
    logger: createLogger('test', { level: 'silent' }),
    fetchFn,
    now: () => new Date('2026-10-09T22:00:00Z'),
  });
  return { svc, urls };
}

describe('PreflightService', () => {
  it('builds one embed from recorded responses, with the advisory footer', async () => {
    const { svc } = service(fixture('tfr-wfs.json'));
    const embed = buildPreflightEmbed(await svc.report('kden')).toJSON();
    expect(embed.title).toBe('Preflight: KDEN (Denver Intl, CO, US)');
    expect(embed.description).toMatch(/CAUTION.*Wind 17 kt exceeds 15 kt/);
    expect(embed.footer?.text).toContain(ADVISORY_NOTICE);
    expect(embed.footer?.text).toMatch(/^Arkhon Industries · Certa/);
    expect(embed.fields?.find((f) => f.name === 'TFRs')?.value).toBe(
      'No published TFRs within 30 NM. Verify at tfr.faa.gov.',
    );
  });

  it('shows a clear fallback when the TFR feed is down, and caches the other sources', async () => {
    const { svc, urls } = service('<html>maintenance</html>');
    const embed = buildPreflightEmbed(await svc.report('KDEN')).toJSON();
    expect(embed.fields?.find((f) => f.name === 'TFRs')?.value).toBe(TFR_UNAVAILABLE);
    const before = urls.length;
    await svc.report('KDEN');
    expect(urls.slice(before).every((u) => u.includes('geoserver'))).toBe(true);
  });
});
