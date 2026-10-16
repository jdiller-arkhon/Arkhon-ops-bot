import { arkhonEmbed, footerText, truncate } from '@arkhon/shared';
import { time, TimestampStyles, type EmbedBuilder } from 'discord.js';
import { formatKp } from './assess.js';
import type { MetarObservation } from './metar.js';
import { POSITION_UNKNOWN, type PreflightReport } from './service.js';

export const ADVISORY_NOTICE =
  'Advisory only. Check official sources (1800wxbrief, NOTAMs, tfr.faa.gov) and get airspace ' +
  'authorization (LAANC or FAADroneZone) where required before flight.';

export const TFR_UNAVAILABLE = 'TFR data unavailable, check tfr.faa.gov';

const relative = (date: Date) => time(date, TimestampStyles.RelativeTime);

function windText(metar: MetarObservation): string {
  if (metar.windSpeedKt === null) return 'n/a';
  if (metar.windSpeedKt === 0) return 'Calm';
  const dir =
    metar.windDirection === null
      ? ''
      : metar.windDirection === 'VRB'
        ? 'VRB '
        : `${String(metar.windDirection).padStart(3, '0')}° `;
  const gust = metar.gustKt !== null ? ` G${metar.gustKt}` : '';
  return `${dir}${metar.windSpeedKt}${gust} kt`;
}

function conditionsText(metar: MetarObservation): string {
  const vis =
    metar.visibilitySm === null
      ? 'n/a'
      : `${metar.visibilitySm}${metar.visibilitySm >= 10 ? '+' : ''} SM`;
  const lines = [
    `**Wind** ${windText(metar)}`,
    `**Visibility** ${vis}`,
    `**Ceiling** ${metar.ceilingFt === null ? 'None' : `${metar.ceilingFt.toLocaleString('en-US')} ft`}`,
  ];
  if (metar.temperatureC !== null) {
    lines.push(`**Temp/Dew** ${metar.temperatureC}°C / ${metar.dewpointC ?? 'n/a'}°C`);
  }
  if (metar.altimeterInHg !== null)
    lines.push(`**Altimeter** ${metar.altimeterInHg.toFixed(2)} inHg`);
  if (metar.weather) lines.push(`**Weather** ${metar.weather}`);
  if (metar.flightCategory) lines.push(`**Category** ${metar.flightCategory}`);
  return lines.join('\n');
}

const code = (text: string) => truncate('```' + text + '```', 1024);

/**
 * One embed per airport: summary line, METAR, TAF, Kp and nearby TFRs. The footer always carries
 * the advisory notice after the house footer.
 */
export function buildPreflightEmbed(report: PreflightReport): EmbedBuilder {
  const { assessment } = report;
  const metar = report.metar.ok ? report.metar.value : null;
  const summary =
    assessment.level === 'GO'
      ? '🟢 **GO**: conditions within configured limits'
      : `🟡 **CAUTION**: ${assessment.reasons.join('; ')}`;

  const fields: { name: string; value: string; inline?: boolean }[] = [];
  if (!report.metar.ok)
    fields.push({ name: 'METAR', value: `Unavailable (${report.metar.error})` });
  else if (!metar)
    fields.push({ name: 'METAR', value: 'No recent METAR reported for this station.' });
  else {
    fields.push({ name: 'Conditions', value: conditionsText(metar) });
    fields.push({ name: `METAR (observed ${relative(metar.observedAt)})`, value: code(metar.raw) });
  }

  if (!report.taf.ok) fields.push({ name: 'TAF', value: `Unavailable (${report.taf.error})` });
  else if (!report.taf.value)
    fields.push({ name: 'TAF', value: 'No TAF issued for this station.' });
  else fields.push({ name: 'TAF', value: code(report.taf.value.raw) });

  if (!report.kp.ok || !report.kp.value) {
    const why = report.kp.ok ? '' : ` (${report.kp.error})`;
    fields.push({ name: 'Planetary Kp', value: `Unavailable${why}`, inline: true });
  } else {
    const { kp, observedAt } = report.kp.value;
    const elevated = assessment.reasons.some((reason) => reason.startsWith('Kp '));
    fields.push({
      name: 'Planetary Kp',
      value: `${elevated ? '⚠️ ' : ''}Kp ${formatKp(kp)}${elevated ? ' (elevated: GPS degradation possible)' : ''}\n${relative(observedAt)}`,
      inline: true,
    });
  }

  if (!report.tfrs.ok) {
    fields.push({
      name: 'TFRs',
      value:
        report.tfrs.error === POSITION_UNKNOWN
          ? 'Airport position unknown without a METAR; check tfr.faa.gov'
          : TFR_UNAVAILABLE,
    });
  } else if (report.tfrs.value.length === 0) {
    fields.push({
      name: 'TFRs',
      value: `No published TFRs within ${report.tfrRadiusNm} NM. Verify at tfr.faa.gov.`,
    });
  } else {
    const lines = report.tfrs.value
      .slice(0, 6)
      .map(
        (tfr) =>
          `• **${tfr.notamId}** ${tfr.type}${tfr.distanceNm === 0 ? ' (**overhead**)' : `, ${tfr.distanceNm.toFixed(0)} NM`}\n${tfr.title}`,
      );
    if (report.tfrs.value.length > 6) {
      lines.push(`…and ${report.tfrs.value.length - 6} more at tfr.faa.gov`);
    }
    fields.push({ name: `⚠️ TFRs nearby (${report.tfrs.value.length})`, value: lines.join('\n') });
  }

  return arkhonEmbed({
    title: metar?.name ? `Preflight: ${report.icao} (${metar.name})` : `Preflight: ${report.icao}`,
    description: summary,
    product: 'certa',
    fields,
    timestamp: report.generatedAt,
  }).setFooter({ text: `${footerText('certa')} · ${ADVISORY_NOTICE}` });
}
