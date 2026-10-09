import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { ZodError } from 'zod';
import type { OpsContext } from '../context.js';
import { announceRelease } from './announce.js';
import { parseGithubRelease, parseReleaseWebhook, type Release } from './payload.js';
import { verifySignature } from './signature.js';

export const RELEASE_PATH = '/webhooks/release';
export const GITHUB_PATH = '/webhooks/github';
export const SIGNATURE_HEADER = 'x-arkhon-signature';
const MAX_BODY_BYTES = 1024 * 1024;

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

function readBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new HttpError(413, 'payload too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function send(res: ServerResponse, status: number, body: Record<string, unknown>): void {
  if (res.headersSent) return;
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

function parseJson(raw: Buffer): unknown {
  try {
    return JSON.parse(raw.toString('utf8'));
  } catch {
    throw new HttpError(400, 'body must be JSON');
  }
}

/**
 * HTTP server for release notifications.
 *
 *   POST /webhooks/release   custom payload {product, version, notes, url?}
 *                            signed with X-Arkhon-Signature: sha256=<hmac of raw body>.
 *                            GitHub "release" webhooks may also be pointed here; they are
 *                            detected by the X-GitHub-Event header.
 *   POST /webhooks/github    GitHub "release" webhooks, signed with X-Hub-Signature-256.
 *   GET  /healthz            liveness + Discord readiness.
 */
export function createWebhookServer(ctx: OpsContext): Server {
  const { logger, config } = ctx;

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const path = new URL(req.url ?? '/', 'http://localhost').pathname;

    if (req.method === 'GET' && path === '/healthz') {
      const ready = ctx.client.isReady();
      send(res, ready ? 200 : 503, { ok: ready });
      return;
    }
    if (path !== RELEASE_PATH && path !== GITHUB_PATH) throw new HttpError(404, 'not found');
    if (req.method !== 'POST') throw new HttpError(405, 'method not allowed');

    const raw = await readBody(req);
    const githubEvent = req.headers['x-github-event'];
    const isGithub = path === GITHUB_PATH || typeof githubEvent === 'string';

    let release: Release;
    if (isGithub) {
      const secret = config.webhooks.githubSecret;
      if (!secret) throw new HttpError(404, 'GitHub webhooks are not configured');
      if (!verifySignature(raw, req.headers['x-hub-signature-256'], secret)) {
        throw new HttpError(401, 'invalid signature');
      }
      if (githubEvent === 'ping') {
        send(res, 200, { ok: true, pong: true });
        return;
      }
      if (githubEvent !== 'release') {
        send(res, 202, { ok: true, ignored: `event ${String(githubEvent)}` });
        return;
      }
      const result = parseGithubRelease(parseJson(raw), config.webhooks.githubReleaseRepos);
      if (result.kind === 'ignored') {
        logger.info({ reason: result.reason }, 'github release ignored');
        send(res, 202, { ok: true, ignored: result.reason });
        return;
      }
      release = result.release;
    } else {
      if (!verifySignature(raw, req.headers[SIGNATURE_HEADER], config.webhooks.releaseSecret)) {
        throw new HttpError(401, 'invalid signature');
      }
      release = parseReleaseWebhook(parseJson(raw));
    }

    if (!ctx.client.isReady()) throw new HttpError(503, 'bot is not connected to Discord yet');
    const result = await announceRelease(ctx, release);
    send(res, result.status === 'posted' ? 201 : 200, { ok: true, ...result });
  }

  return createServer((req, res) => {
    const started = performance.now();
    handle(req, res)
      .catch((error: unknown) => {
        if (error instanceof HttpError) {
          send(res, error.status, { ok: false, error: error.message });
        } else if (error instanceof ZodError) {
          send(res, 400, {
            ok: false,
            error: 'invalid payload',
            issues: error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`),
          });
        } else {
          logger.error({ err: error }, 'webhook handler failed');
          send(res, 500, { ok: false, error: 'internal error' });
        }
      })
      .finally(() => {
        logger.info(
          {
            method: req.method,
            path: req.url,
            status: res.statusCode,
            durationMs: Math.round(performance.now() - started),
          },
          'webhook request',
        );
      });
  });
}
