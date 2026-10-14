/**
 * Cloudflare entry point for the Arkhon bots.
 *
 * Each bot is the unchanged Docker image (e.g. bots/ops/Dockerfile) running on Cloudflare
 * Containers as a single always-on instance. This Worker:
 *   - forwards the bots' public HTTP routes (release, GitHub and member webhooks, /healthz),
 *   - passes the Worker's secrets to the container as environment variables,
 *   - keeps the gateway connection alive: containers normally sleep when no HTTP traffic arrives,
 *     so activity expiry is ignored and a cron trigger starts the container after deploys or crashes,
 *   - restarts the container when the secrets change, so new values take effect within 5 minutes,
 *   - serves the bot's database: queries the container sends to http://d1.internal run against the
 *     Worker's D1 binding (see d1-bridge.ts), so no database outside Cloudflare is needed.
 *
 * Logging here uses console, which is how Workers logs reach `wrangler tail` and the dashboard.
 */
import { Container } from '@cloudflare/containers';
// Required for outboundByHost: the container's outbound requests are routed through this entrypoint.
export { ContainerProxy } from '@cloudflare/containers';
import { D1_BRIDGE_HOST } from '../../../packages/shared/src/d1-bridge.js';
import {
  BOTS,
  INSTANCE_NAME,
  botForPath,
  containerEnv,
  envFingerprint,
  missingRequired,
  type BotDeployment,
} from './bots.js';
import { handleD1BridgeRequest } from './d1-bridge.js';

/** Storage key for the fingerprint of the configuration the running container started with. */
const STARTED_WITH = 'startedWithEnv';

interface Env {
  OPS_BOT: DurableObjectNamespace<OpsBot>;
  DB: D1Database;
  [key: string]: unknown;
}

/** Shared behaviour for every bot container. */
abstract class BotContainer extends Container<Env> {
  // Checked periodically; onActivityExpired below keeps the instance running regardless.
  override sleepAfter = '1h';

  /** A Discord bot holds a gateway connection with no inbound HTTP, so it must never sleep. */
  override async onActivityExpired(): Promise<void> {
    // Not stopping renews the activity timer (see @cloudflare/containers).
  }

  /** Remember which configuration this run started with. */
  override async onStart(): Promise<void> {
    await this.ctx.storage.put(STARTED_WITH, await envFingerprint(this.envVars ?? {}));
  }

  /**
   * Stops the container when the Worker's secrets or vars changed since it started, so the next
   * health check starts it again with the new values. Returns true when it restarted.
   */
  async restartIfConfigChanged(): Promise<boolean> {
    const state = await this.getState();
    if (state.status !== 'running' && state.status !== 'healthy') return false;
    const started = await this.ctx.storage.get<string>(STARTED_WITH);
    const current = await envFingerprint(this.envVars ?? {});
    if (!started || started === current) return false;
    await this.stop();
    for (let i = 0; i < 30; i++) {
      const { status } = await this.getState();
      if (status === 'stopped' || status === 'stopped_with_code') break;
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    return true;
  }

  override onError(error: unknown): void {
    console.error(
      JSON.stringify({ msg: 'container error', bot: this.constructor.name, error: String(error) }),
    );
  }
}

export class OpsBot extends BotContainer {
  override defaultPort = BOTS.ops.port;

  constructor(ctx: ConstructorParameters<typeof Container>[0], env: Env) {
    super(ctx, env);
    this.envVars = containerEnv(BOTS.ops, env);
  }
}

// The bot's database bridge, reachable only from inside the container. Assigned (not a static
// class field) so it goes through Container's setter, which registers handlers by class name.
OpsBot.outboundByHost = {
  [D1_BRIDGE_HOST]: (request: Request, env: Env) => handleD1BridgeRequest(request, env.DB),
};

function instance(env: Env, bot: BotDeployment): DurableObjectStub<OpsBot> {
  return env[bot.binding].getByName(INSTANCE_NAME);
}

function configProblems(env: Env, bot: BotDeployment): string[] {
  return missingRequired(bot, containerEnv(bot, env));
}

/** Starts the container if it is not running (any fetch does) and reports its health. */
async function ensureRunning(env: Env, key: string, bot: BotDeployment): Promise<void> {
  const problems = configProblems(env, bot);
  if (problems.length) {
    console.error(
      JSON.stringify({
        msg: 'bot not started: missing configuration',
        bot: key,
        missing: problems,
      }),
    );
    return;
  }
  try {
    const stub = instance(env, bot);
    if (await stub.restartIfConfigChanged()) {
      console.log(JSON.stringify({ msg: 'configuration changed: restarting', bot: key }));
    }
    const res = await stub.fetch(`http://${key}.internal/healthz`);
    console.log(JSON.stringify({ msg: 'health check', bot: key, status: res.status }));
  } catch (error) {
    console.error(JSON.stringify({ msg: 'health check failed', bot: key, error: String(error) }));
  }
}

export default {
  async fetch(request, env): Promise<Response> {
    const key = botForPath(new URL(request.url).pathname);
    if (!key) return new Response('Not found', { status: 404 });
    const bot = BOTS[key];
    const problems = configProblems(env, bot);
    if (problems.length) {
      return Response.json({ error: 'bot is not configured', missing: problems }, { status: 503 });
    }
    return instance(env, bot).fetch(request);
  },

  async scheduled(_controller, env, ctx): Promise<void> {
    for (const [key, bot] of Object.entries(BOTS)) ctx.waitUntil(ensureRunning(env, key, bot));
  },
} satisfies ExportedHandler<Env>;
