import Fastify from 'fastify';
import { readFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { HealthResponse, SystemStatus, SERVICES, HealthDot } from '@zoci/shared';
import { Registry } from '@zoci/shared/metrics';

// True only when this file is the process entry point (prod `node dist/server.js` or
// `tsx src/server.ts`), false when imported by a test. Gates listen() + logging below,
// so a test can import { app } and use fastify.inject() without binding a port.
const isEntry = path.resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url);

// v1 backend skeleton (site spec §6): wiring in place, features growing.
const app = Fastify({ logger: isEntry });

const PORT = Number(process.env.PORT ?? 8000);
const HOST = process.env.HOST ?? '0.0.0.0';
const BROKER_URL = process.env.BROKER_URL ?? 'http://ha-broker:8080';

// Metrics (spec §3). The `route` label is always the registered route template, never the raw
// path, to bound cardinality; no identity or email is ever a label (that is the audit log, §6).
const registry = new Registry();
const requestsTotal = registry.counter('zoci_api_requests_total', 'API requests by route and status.');
const errorsTotal = registry.counter('zoci_api_errors_total', 'API errors that did not crash the container.');
const requestDuration = registry.histogram('zoci_api_request_duration_seconds', 'API request duration in seconds.');
const inflightRequests = registry.gauge('zoci_api_inflight_requests', 'API requests currently in flight.');

// Fastify fires onRequest for every request and onResponse when the reply is sent, so inflight
// stays balanced and every response (including 401/404/5xx) is counted exactly once.
app.addHook('onRequest', async () => {
  inflightRequests.inc();
});
app.addHook('onResponse', async (request, reply) => {
  inflightRequests.dec();
  const route = request.routeOptions?.url ?? 'unmatched';
  requestsTotal.inc({ route, status: String(reply.statusCode) });
  requestDuration.observe(reply.elapsedTime / 1000, { route });
});
app.addHook('onError', async (request, _reply, error) => {
  const route = request.routeOptions?.url ?? 'unmatched';
  errorsTotal.inc({ route, kind: error.name || 'Error' });
});

// Local-dev escape hatch: in production the guest surface is gated by oauth2-proxy/Google
// (Caddy sets X-Auth-Request-Email). There's no oauth2-proxy in `npm run dev`, so when
// GUEST_DEV is set the guest routes fall back to this stub identity instead of 401. NEVER
// set GUEST_DEV in the deployed compose; prod stays hard-gated. See DEVELOPMENT.md.
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
// maps it against the canonical SERVICES list; it never talks to Docker, so the
// internet-facing container needs no Docker socket. Prod sets STATUS_FILE via compose; the
// dev default points at the in-repo file.
const STATUS_FILE =
  process.env.STATUS_FILE ??
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../infra/status/status.json');

// The host-side verdict evaluator (infra/status/write-verdict.py) writes these next to the status
// file, in the same read-only ./status mount. The public dot is served here on the main (public)
// listener; the FULL verdict is served only on the admin listener below, never on :8000.
const STATUS_DIR = path.dirname(STATUS_FILE);
const VERDICT_FILE = process.env.VERDICT_FILE ?? path.join(STATUS_DIR, 'verdict.json');
const DOT_FILE = process.env.DOT_FILE ?? path.join(STATUS_DIR, 'health-dot.json');
const ACCESS_FILE = process.env.ACCESS_FILE ?? path.join(STATUS_DIR, 'access.jsonl');

app.get('/health', async (): Promise<HealthResponse> => {
  return { status: 'ok' };
});

// Public aggregate health dot (spec §4/Part I): the only health signal on the public path. A
// missing/unreadable file reads as "unknown"; the front page also treats a stale updatedAt as
// unknown. The full verdict is NOT reachable here.
app.get('/health-dot', async (): Promise<HealthDot> => {
  try {
    return HealthDot.parse(JSON.parse(await readFile(DOT_FILE, 'utf8')));
  } catch {
    return { status: 'unknown' };
  }
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
// copy. This route hard-requires that header; a request lacking it (e.g. the public zoci.me/api/*
// path, where Caddy strips it) is refused. The HA token lives in ha-broker, never here.
app.register(
  async (guest) => {
    guest.addHook('preHandler', async (req, reply) => {
      let email = req.headers['x-auth-request-email'];
      if ((typeof email !== 'string' || email === '') && GUEST_DEV_EMAIL) {
        // No oauth2-proxy in local dev: stand in a stub identity so the header-required
        // routes below (and the '/' page) work. Off unless GUEST_DEV is set.
        req.headers['x-auth-request-email'] = email = GUEST_DEV_EMAIL;
      }
      if (typeof email !== 'string' || email === '') {
        return reply.code(401).send({ error: 'unauthenticated' });
      }
    });
    // Curated dashboard data, proxied from ha-broker (which holds the HA token).
    guest.get('/dashboard', async (_req, reply) => {
      const res = await fetch(`${BROKER_URL}/dashboard`).catch(() => null);
      if (!res || !res.ok) return reply.code(502).send({ error: 'broker unavailable' });
      return reply.send(await res.json());
    });
    // Drive a whitelisted control to a desired state: forward the opaque {key, value} to the
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
    // and posts /command, both on this same vhost, so they land back on these guest routes.
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

// Metrics listener: a second server on an internal-only port, reachable by VictoriaMetrics over
// the `metrics` docker network and never host-published, so /metrics is never on the Caddy-proxied
// :8000 (zoci.me/api/metrics stays 404). It merges ha-broker's /metrics, fetched over the broker
// network, so VictoriaMetrics never connects to the token holder directly.
const metricsApp = Fastify({ logger: false });
metricsApp.get('/metrics', async (_req, reply) => {
  let body = registry.expose();
  try {
    const res = await fetch(`${BROKER_URL}/metrics`);
    if (res.ok) body += await res.text();
  } catch {
    // Broker unreachable: serve api's own metrics; ha-broker liveness is covered elsewhere (§3).
  }
  return reply.type('text/plain; version=0.0.4').send(body);
});

// Admin data listener: the FULL verdict (and, later, the recent-access panel) on an internal-only
// port that ONLY the tailnet-gated admin.zoci.me vhost proxies. It is never on the public :8000
// listener, so zoci.me/api/verdict cannot reach it; the public/admin split is structural, not a
// header check. Only the one-bit /health-dot crosses to the public site.
const adminApp = Fastify({ logger: false });
adminApp.get('/verdict', async (_req, reply) => {
  try {
    return JSON.parse(await readFile(VERDICT_FILE, 'utf8'));
  } catch {
    return reply.send({ overall: 'unknown', summary: 'Verdict unavailable', problems: [] });
  }
});

// Recent access-audit records (§6), most-recent first. Read-only from the host-written store; the
// full log/store never leave the tailnet admin surface.
adminApp.get('/recent-access', async (_req, reply) => {
  try {
    const lines = (await readFile(ACCESS_FILE, 'utf8')).trim().split('\n').filter(Boolean);
    const out: unknown[] = [];
    for (const l of lines.slice(-50).reverse()) {
      // Skip a malformed line (e.g. a partial write racing the processor) rather than dropping the
      // whole result.
      try {
        out.push(JSON.parse(l));
      } catch {
        /* ignore this line */
      }
    }
    return out;
  } catch {
    return reply.send([]);
  }
});

if (isEntry) {
  app
    .listen({ port: PORT, host: HOST })
    .then((addr) => app.log.info(`api listening on ${addr}`))
    .catch((err) => {
      app.log.error(err);
      process.exit(1);
    });

  const METRICS_PORT = Number(process.env.METRICS_PORT ?? 9101);
  const METRICS_HOST = process.env.METRICS_HOST ?? '0.0.0.0';
  metricsApp
    .listen({ port: METRICS_PORT, host: METRICS_HOST })
    .then((addr) => app.log.info(`api metrics listening on ${addr}`))
    .catch((err) => {
      app.log.error(err);
      process.exit(1);
    });

  const ADMIN_PORT = Number(process.env.ADMIN_PORT ?? 9102);
  const ADMIN_HOST = process.env.ADMIN_HOST ?? '0.0.0.0';
  adminApp
    .listen({ port: ADMIN_PORT, host: ADMIN_HOST })
    .then((addr) => app.log.info(`api admin listening on ${addr}`))
    .catch((err) => {
      app.log.error(err);
      process.exit(1);
    });
}

export { app, metricsApp, adminApp };
