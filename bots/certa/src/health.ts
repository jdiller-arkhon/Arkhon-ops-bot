import { createServer, type Server } from 'node:http';

/**
 * /healthz for Docker and the Cloudflare Worker: 200 once the bot is connected to Discord, 503
 * before. The bot has no other HTTP routes.
 */
export function createHealthServer(isReady: () => boolean): Server {
  return createServer((req, res) => {
    if (req.method === 'GET' && req.url === '/healthz') {
      const ready = isReady();
      res.writeHead(ready ? 200 : 503, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: ready }));
      return;
    }
    res.writeHead(404).end();
  });
}
