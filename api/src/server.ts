import Fastify from 'fastify';
import { readFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { HealthResponse, SystemStatus, SERVICES } from '@zoci/shared';

// v1 backend skeleton (site spec §6): wiring in place, features growing.
const app = Fastify({ logger: true });

const PORT = Number(process.env.PORT ?? 8000);
const HOST = process.env.HOST ?? '0.0.0.0';
const BROKER_URL = process.env.BROKER_URL ?? 'http://ha-broker:8080';

// The themed guest dashboard page, served at guest.zoci.me. Read once at startup;
// __EMAIL__ is filled per request. Its JS calls /dashboard + /toggle (same vhost).
const GUEST_HTML = readFileSync(
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'guest.html'),
  'utf8',
);

// Container health is produced out-of-band by a host cron (infra/status/write-status.sh),
// which writes the names of all running containers to a file. The api reads that file and
// maps it against the canonical SERVICES list — it never talks to Docker, so the
// internet-facing container needs no Docker socket. Prod sets STATUS_FILE via compose; the
// dev default points at the in-repo file.
const STATUS_FILE =
  process.env.STATUS_FILE ??
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../infra/status/status.json');

app.get('/health', async (): Promise<HealthResponse> => {
  return { status: 'ok' };
});

app.get('/status', async (): Promise<SystemStatus> => {
  let running = new Set<string>();
  let updatedAt: string | undefined;
  try {
    const parsed = JSON.parse(await readFile(STATUS_FILE, 'utf8')) as {
      running?: unknown;
      updatedAt?: unknown;
    };
    if (Array.isArray(parsed.running)) {
      running = new Set(parsed.running.filter((x): x is string => typeof x === 'string'));
    }
    if (typeof parsed.updatedAt === 'string') updatedAt = parsed.updatedAt;
  } catch (err) {
    // Missing/unreadable file (cron not running yet): report all down rather than 500.
    app.log.warn({ err }, 'could not read status file');
  }
  return {
    containers: SERVICES.map((s) => ({ name: s.name, running: running.has(s.container) })),
    updatedAt,
  };
});

// Guest surface (secure-access.md §7.2). Reached ONLY via guest.zoci.me, where Caddy's
// forward_auth (oauth2-proxy → Google) sets X-Auth-Request-Email and strips any client-sent
// copy. We hard-require that header — a request lacking it (e.g. the public zoci.me/api/*
// path, where Caddy strips it) is refused. The HA token lives in ha-broker, never here.
app.register(
  async (guest) => {
    guest.addHook('preHandler', async (req, reply) => {
      const email = req.headers['x-auth-request-email'];
      if (typeof email !== 'string' || email === '') {
        return reply.code(401).send({ error: 'unauthenticated' });
      }
    });
    // Curated dashboard data — proxied from ha-broker (which holds the HA token).
    guest.get('/dashboard', async (_req, reply) => {
      const res = await fetch(`${BROKER_URL}/dashboard`).catch(() => null);
      if (!res || !res.ok) return reply.code(502).send({ error: 'broker unavailable' });
      return reply.send(await res.json());
    });
    // Toggle a whitelisted light — forward the opaque key to the broker (which maps it to
    // an entity + the fixed light.toggle service). api never sees or sends an entity_id.
    guest.post('/toggle', async (req, reply) => {
      const res = await fetch(`${BROKER_URL}/toggle`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(req.body ?? {}),
      }).catch(() => null);
      if (!res) return reply.code(502).send({ error: 'broker unavailable' });
      return reply.code(res.status).send(await res.json());
    });
    // The themed guest dashboard page (per-room light controls). Its JS pulls /dashboard
    // and posts /toggle — both on this same vhost, so they land back on these guest routes.
    guest.get('/', async (req, reply) => {
      const email = String(req.headers['x-auth-request-email'] ?? '');
      const safe = email.replace(
        /[&<>"']/g,
        (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string,
      );
      return reply.type('text/html').send(GUEST_HTML.replace('__EMAIL__', safe));
    });
  },
  { prefix: '/guest' },
);

app
  .listen({ port: PORT, host: HOST })
  .then((addr) => app.log.info(`api listening on ${addr}`))
  .catch((err) => {
    app.log.error(err);
    process.exit(1);
  });
