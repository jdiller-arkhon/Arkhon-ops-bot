/**
 * Cloudflare entry point for the Arkhon bots.
 *
 * Each bot is the unchanged Docker image (e.g. bots/ops/Dockerfile) running on Cloudflare
 * Containers as a single always-on instance. This Worker:
 *   - forwards the bots' public HTTP routes (release, GitHub and member webhooks, /healthz),
 *   - passes the Worker's secrets to the container as environment variables,
 *   - keeps the gateway connection alive: containers normally sleep when no HTTP traffic arrives,
 *     so activity expiry is ignored and a cron trigger starts the container after deploys or crashes.
 *
 * Logging here uses console, which is how Workers logs reach `wrangler tail` and the dashboard.
 */
import { Container } from '@cloudflare/containers';
import {
  BOTS,
  INSTANCE_NAME,
  botForPath,
  containerEnv,
  missingRequired,
  type BotDeployment,
} from './bots.js';

interface Env {
  OPS_BOT: DurableObjectNamespace<OpsBot>;
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
    const res = await instance(env, bot).fetch(`http://${key}.internal/healthz`);
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
