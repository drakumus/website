import Fastify from 'fastify';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { CountryCode, Products } from 'plaid';
import { config, configured } from './config.js';
import { plaid } from './plaid.js';
import { encryptToken, decryptToken } from './crypto.js';
import { pool, bootstrap } from './db.js';
import { syncAll } from './sync.js';
import { overview } from './reads.js';

// True only when this file is the process entry point (prod `tsx src/server.ts` or
// `node dist/server.js`), false when imported by a test. Gates listen() + logging below.
const isEntry = path.resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url);

// Finance backend (see ~/specs/finance-dashboard.md). The only process that holds the Plaid
// credentials and the Postgres connection; reachable only via the tailnet-only finance.zoci.me
// vhost. Until the Plaid credentials and encryption key are set it stays up on /health and reports
// unconfigured, mirroring ha-broker's gating on HA_TOKEN.
const app = Fastify({ logger: isEntry });

// Liveness only: no Plaid or DB call, so the container is healthy before credentials are set.
app.get('/health', async () => ({ status: 'ok' }));

// Configuration + linked-item summary for the dashboard shell. Reports unconfigured rather than
// erroring when credentials are missing, and tolerates a database that is not up yet.
app.get('/status', async (_req, reply) => {
  if (!configured) return { configured: false, items: [] };
  try {
    const { rows } = await pool.query(
      'select item_id, institution_name, status, last_sync_at, last_error from items order by created_at',
    );
    return { configured: true, items: rows };
  } catch {
    return reply.code(503).send({ configured: true, items: [], error: 'database unavailable' });
  }
});

// The dashboard read model: net worth, spend by merchant/category/month, recurring, and holdings,
// over the last `days` (default 90). Read-only aggregation from Postgres.
app.get('/overview', async (req, reply) => {
  if (!configured) return reply.code(503).send({ error: 'unconfigured' });
  const raw = Number((req.query as { days?: string }).days ?? 90);
  const days = Math.min(Math.max(Number.isFinite(raw) ? raw : 90, 1), 730);
  try {
    return await overview(days);
  } catch (err) {
    app.log.error(err);
    return reply.code(503).send({ error: 'database unavailable' });
  }
});

// Create a Link token for the one-time account linking (and for update mode when an Item breaks).
// redirect_uri is required for OAuth banks (Chase) and must be registered in the Plaid dashboard.
app.post('/link/token/create', async (_req, reply) => {
  if (!configured) return reply.code(503).send({ error: 'unconfigured' });
  try {
    const res = await plaid.linkTokenCreate({
      user: { client_user_id: 'operator' },
      client_name: 'zoci finance',
      products: [Products.Transactions, Products.Investments],
      country_codes: [CountryCode.Us],
      language: 'en',
      transactions: { days_requested: 730 },
      ...(config.redirectUri ? { redirect_uri: config.redirectUri } : {}),
    });
    return { link_token: res.data.link_token, expiration: res.data.expiration };
  } catch (err) {
    app.log.error(err);
    return reply.code(502).send({ error: 'link_token_create failed' });
  }
});

// Exchange a public token for an access token, resolve the institution, and store the Item with the
// access token encrypted at rest. Idempotent on re-link of the same Item.
app.post('/link/exchange', async (req, reply) => {
  if (!configured) return reply.code(503).send({ error: 'unconfigured' });
  const body = (req.body ?? {}) as { public_token?: unknown };
  if (typeof body.public_token !== 'string') {
    return reply.code(400).send({ error: 'public_token required' });
  }
  try {
    const ex = await plaid.itemPublicTokenExchange({ public_token: body.public_token });
    const accessToken = ex.data.access_token;
    const itemId = ex.data.item_id;

    const itemGet = await plaid.itemGet({ access_token: accessToken });
    const institutionId = itemGet.data.item.institution_id ?? null;
    let institutionName: string | null = null;
    if (institutionId) {
      const inst = await plaid.institutionsGetById({
        institution_id: institutionId,
        country_codes: [CountryCode.Us],
      });
      institutionName = inst.data.institution.name;
    }

    await pool.query(
      `insert into items (item_id, institution_id, institution_name, access_token_enc, status)
       values ($1, $2, $3, $4, 'active')
       on conflict (item_id) do update set
         institution_id = excluded.institution_id,
         institution_name = excluded.institution_name,
         access_token_enc = excluded.access_token_enc,
         status = 'active',
         last_error = null`,
      [itemId, institutionId, institutionName, encryptToken(accessToken)],
    );
    return { item_id: itemId, institution: institutionName };
  } catch (err) {
    app.log.error(err);
    return reply.code(502).send({ error: 'exchange failed' });
  }
});

// Pull every linked Item now (transactions, recurring, holdings), then return the per-Item state.
// The scheduler below calls the same syncAll on an interval; this route is the on-demand trigger.
app.post('/sync', async (_req, reply) => {
  if (!configured) return reply.code(503).send({ error: 'unconfigured' });
  await syncAll();
  const { rows } = await pool.query(
    'select item_id, institution_name, status, last_sync_at, last_error from items order by created_at',
  );
  return { items: rows };
});

// Update-mode Link token: re-authenticate an Item that went login_required, without re-linking from
// scratch. Passing access_token puts Link into update mode for that Item.
app.post('/link/token/update', async (req, reply) => {
  if (!configured) return reply.code(503).send({ error: 'unconfigured' });
  const body = (req.body ?? {}) as { item_id?: unknown };
  if (typeof body.item_id !== 'string') return reply.code(400).send({ error: 'item_id required' });
  try {
    const { rows } = await pool.query('select access_token_enc from items where item_id = $1', [
      body.item_id,
    ]);
    if (!rows[0]) return reply.code(404).send({ error: 'unknown item' });
    const res = await plaid.linkTokenCreate({
      user: { client_user_id: 'operator' },
      client_name: 'zoci finance',
      country_codes: [CountryCode.Us],
      language: 'en',
      access_token: decryptToken(rows[0].access_token_enc),
      ...(config.redirectUri ? { redirect_uri: config.redirectUri } : {}),
    });
    return { link_token: res.data.link_token, expiration: res.data.expiration };
  } catch (err) {
    app.log.error(err);
    return reply.code(502).send({ error: 'link_token_update failed' });
  }
});

// Offboarding: remove the Item at Plaid (revokes access and stops per-Item billing) and delete it
// locally. The delete cascades to that Item's accounts, transactions, and holdings.
app.post('/item/remove', async (req, reply) => {
  if (!configured) return reply.code(503).send({ error: 'unconfigured' });
  const body = (req.body ?? {}) as { item_id?: unknown };
  if (typeof body.item_id !== 'string') return reply.code(400).send({ error: 'item_id required' });
  try {
    const { rows } = await pool.query('select access_token_enc from items where item_id = $1', [
      body.item_id,
    ]);
    if (rows[0]) {
      await plaid.itemRemove({ access_token: decryptToken(rows[0].access_token_enc) });
    }
    await pool.query('delete from items where item_id = $1', [body.item_id]);
    return { removed: body.item_id };
  } catch (err) {
    app.log.error(err);
    return reply.code(502).send({ error: 'item_remove failed' });
  }
});

if (isEntry) {
  bootstrap().catch((err) => app.log.error({ err }, 'schema bootstrap failed'));

  // Scheduled pull. The box is tailnet-only, so Plaid cannot reach it with webhooks; polling on an
  // interval is the pull mechanism. A single in-flight guard keeps a slow run from overlapping.
  const SYNC_INTERVAL_MS = Number(process.env.FINANCE_SYNC_INTERVAL_MS ?? 6 * 60 * 60 * 1000);
  let syncing = false;
  const tick = async (): Promise<void> => {
    if (syncing || !configured) return;
    syncing = true;
    try {
      await syncAll();
    } catch (err) {
      app.log.error({ err }, 'scheduled sync failed');
    } finally {
      syncing = false;
    }
  };
  setInterval(() => void tick(), SYNC_INTERVAL_MS).unref();

  app
    .listen({ port: config.port, host: config.host })
    .then((addr) => app.log.info(`finance listening on ${addr}`))
    .catch((err) => {
      app.log.error(err);
      process.exit(1);
    });
}

export { app };
