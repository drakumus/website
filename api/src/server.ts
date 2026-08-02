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

// Local-dev escape hatch: in production the guest surface is gated by oauth2-proxy/Google
// (Caddy sets X-Auth-Request-Email). There's no oauth2-proxy in `npm run dev`, so when
// GUEST_DEV is set the guest routes fall back to this stub identity instead of 401. NEVER
// set GUEST_DEV in the deployed compose — prod stays hard-gated. See DEVELOPMENT.md.
const GUEST_DEV_EMAIL = process.env.GUEST_DEV ? (process.env.GUEST_DEV_EMAIL ?? 'dev@localhost') : '';

// The guest dashboard page, served at guest.zoci.me. Assembled once at startup: the shared
// theme (@zoci/shared/theme.css) is inlined into the /*__THEME__*/ slot so the page matches
// the main site without duplicating its CSS. __EMAIL__ is then filled per request.
const dir = path.dirname(fileURLToPath(import.meta.url));
const THEME_CSS = readFileSync(path.resolve(dir, '../../shared/theme.css'), 'utf8');
// Data-path base for the page's fetches. Prod is fronted by Caddy (root -> /guest rewrite),
// so the browser uses '' ; local dev has no Caddy, so point the page at the /guest mount.
const GUEST_BASE = GUEST_DEV_EMAIL ? '/guest' : '';
const GUEST_HTML = readFileSync(path.resolve(dir, 'guest.html'), 'utf8')
  .replace('/*__THEME__*/', THEME_CSS)
  .replace('__BASE__', GUEST_BASE);

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
      let email = req.headers['x-auth-request-email'];
      if ((typeof email !== 'string' || email === '') && GUEST_DEV_EMAIL) {
        // No oauth2-proxy in local dev — stand in a stub identity so the header-required
        // routes below (and the '/' page) work. Off unless GUEST_DEV is set.
        req.headers['x-auth-request-email'] = email = GUEST_DEV_EMAIL;
      }
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
    // Drive a whitelisted control to a desired state — forward the opaque {key, value} to the
    // broker (which maps key→entity, issues the explicit service, and verifies HA accepted it).
    // api never sees or sends an entity_id; it just relays the broker's {key, state, verified}.
    guest.post('/command', async (req, reply) => {
      const res = await fetch(`${BROKER_URL}/command`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(req.body ?? {}),
      }).catch(() => null);
      if (!res) return reply.code(502).send({ error: 'broker unavailable' });
      return reply.code(res.status).send(await res.json());
    });
    // The themed guest dashboard page (per-room light controls). Its JS pulls /dashboard
    // and posts /command — both on this same vhost, so they land back on these guest routes.
    guest.get('/', async (req, reply) => {
      const email = String(req.headers['x-auth-request-email'] ?? '');
      const safe = email.replace(
        /[&<>"']/g,
        (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string,
      );
      // Function replacer: a literal string replacement would interpret $-sequences in the
      // (attacker-influenceable) email as replacement patterns.
      return reply.type('text/html').send(GUEST_HTML.replace('__EMAIL__', () => safe));
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
