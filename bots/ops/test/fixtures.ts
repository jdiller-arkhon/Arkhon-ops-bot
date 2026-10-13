import { loadOpsConfig } from '../src/config.js';
import { LayoutStore } from '../src/layout.js';

/** A complete, valid ops bot environment for tests (channel/role ids set as env overrides). */
export const validOpsEnv: Record<string, string> = {
  DISCORD_TOKEN: 'x'.repeat(72),
  DISCORD_CLIENT_ID: '100000000000000001',
  DISCORD_GUILD_ID: '100000000000000002',
  DATABASE_URL: 'file:./test.db',
  SUPPORT_CHANNEL_ID: '200000000000000001',
  TICKET_ARCHIVE_CHANNEL_ID: '200000000000000002',
  START_HERE_CHANNEL_ID: '200000000000000003',
  MOD_LOG_CHANNEL_ID: '200000000000000004',
  ANNOUNCEMENTS_CHANNEL_ID: '200000000000000005',
  FEEDBACK_FORUM_CHANNEL_ID: '200000000000000006',
  CERTA_HOME_CHANNEL_ID: '200000000000000007',
  ARGUS_HOME_CHANNEL_ID: '200000000000000008',
  CERTA_STAFF_ROLE_ID: '300000000000000001',
  ARGUS_STAFF_ROLE_ID: '300000000000000002',
  CERTA_USER_ROLE_ID: '300000000000000003',
  ARGUS_USER_ROLE_ID: '300000000000000004',
  RELEASE_WEBHOOK_SECRET: 'release-secret-0123456789',
};

/** A LayoutStore resolved from the fixture env overrides. */
export function fixtureLayout(env: Record<string, string> = validOpsEnv): LayoutStore {
  const store = new LayoutStore(loadOpsConfig(env).layoutOverrides);
  store.apply({ 'role.verified': '300000000000000009', 'channel.verify': '200000000000000009' });
  return store;
}
