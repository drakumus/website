// Boundary + templating invariants for the api. The api is a dumb relay in front of ha-broker:
// it must hard-require the oauth2-proxy auth header, forward the opaque {key,value} without ever
// injecting an entity_id, and HTML-escape the (attacker-influenceable) email without treating it
// as a String.replace pattern.
//
// Run: `npm test -w api` (node --test via tsx). No real broker; `fetch` is stubbed.
import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { writeFile, unlink, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { HealthResponse } from '@zoci/shared';

// Env is read at module load, so configure it before importing the app. STATUS_DIR is a temp dir
// this suite owns (the verdict/dot/access files live in it); BROKER_URL is a sentinel host so proxy
// calls are easy to assert; GUEST_DEV is unset so the missing-header guard is exercised.
const STATUS_DIR = await mkdtemp(path.join(tmpdir(), 'zoci-api-'));
const VERDICT_FILE = path.join(STATUS_DIR, 'verdict.json');
const DOT_FILE = path.join(STATUS_DIR, 'health-dot.json');
const ACCESS_FILE = path.join(STATUS_DIR, 'access.jsonl');
process.env.STATUS_DIR = STATUS_DIR;
process.env.VERDICT_FILE = VERDICT_FILE;
process.env.DOT_FILE = DOT_FILE;
process.env.ACCESS_FILE = ACCESS_FILE;
process.env.BROKER_URL = 'http://broker.test';
delete process.env.GUEST_DEV;
delete process.env.GUEST_DEV_EMAIL;

// Stub fetch so the broker proxy calls are captured, and each test picks the broker response.
type Call = { url: string; method: string; body: Record<string, unknown> | undefined };
let calls: Call[] = [];
let brokerResponse: () => Response = () => new Response('{}', { status: 200 });
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: unknown, init: { method?: string; body?: string } = {}) => {
  calls.push({
    url: String(input),
    method: init.method ?? 'GET',
    body: init.body ? JSON.parse(init.body) : undefined,
  });
  return brokerResponse();
}) as typeof fetch;

const { app, metricsApp, adminApp } = await import('../src/server.ts');
const AUTH = { 'x-auth-request-email': 'guest@example.com' };

beforeEach(() => {
  calls = [];
  brokerResponse = () => new Response('{}', { status: 200 });
});
after(async () => {
  globalThis.fetch = realFetch;
  await app.close();
  await metricsApp.close();
  await adminApp.close();
});

test('guest routes require the auth header (401), never reaching the broker', async () => {
  for (const url of ['/guest/dashboard', '/guest/']) {
    const res = await app.inject({ method: 'GET', url });
    assert.equal(res.statusCode, 401);
  }
  const cmd = await app.inject({ method: 'POST', url: '/guest/command', payload: { key: 'k', value: 'on' } });
  assert.equal(cmd.statusCode, 401);
  assert.equal(calls.length, 0);
});

test('/guest/dashboard relays the broker payload verbatim', async () => {
  const payload = { rooms: [{ room: 'Guest Bedroom', lights: [{ key: 'gbed', label: 'Main', state: 'on' }] }] };
  brokerResponse = () => new Response(JSON.stringify(payload), { status: 200 });
  const res = await app.inject({ method: 'GET', url: '/guest/dashboard', headers: AUTH });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.json(), payload);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'http://broker.test/dashboard');
  assert.equal(calls[0].method, 'GET');
});

test('/guest/dashboard returns 502 when the broker is unreachable', async () => {
  brokerResponse = () => {
    throw new Error('connection refused');
  };
  const res = await app.inject({ method: 'GET', url: '/guest/dashboard', headers: AUTH });
  assert.equal(res.statusCode, 502);
});

test('/guest/command forwards the opaque body and injects no entity_id', async () => {
  brokerResponse = () => new Response(JSON.stringify({ key: 'gbed', state: 'on', verified: true }), { status: 200 });
  const res = await app.inject({
    method: 'POST',
    url: '/guest/command',
    headers: AUTH,
    payload: { key: 'gbed', value: 'on' },
  });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.json(), { key: 'gbed', state: 'on', verified: true });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'http://broker.test/command');
  assert.equal(calls[0].method, 'POST');
  assert.deepEqual(calls[0].body, { key: 'gbed', value: 'on' }); // exactly what the client sent…
  assert.ok(calls[0].body && !('entity_id' in calls[0].body)); // …the api adds nothing
});

test('/guest/command relays the broker status code (e.g. a rejected value)', async () => {
  brokerResponse = () => new Response(JSON.stringify({ error: 'bad value' }), { status: 400 });
  const res = await app.inject({
    method: 'POST',
    url: '/guest/command',
    headers: AUTH,
    payload: { key: 'gbed', value: 'nope' },
  });
  assert.equal(res.statusCode, 400);
});

test('/guest/command returns 502 when the broker is unreachable', async () => {
  brokerResponse = () => {
    throw new Error('down');
  };
  const res = await app.inject({
    method: 'POST',
    url: '/guest/command',
    headers: AUTH,
    payload: { key: 'gbed', value: 'on' },
  });
  assert.equal(res.statusCode, 502);
});

test('/health is ok and matches the shared schema', async () => {
  const res = await app.inject({ method: 'GET', url: '/health' });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(HealthResponse.parse(res.json()), { status: 'ok' });
});

test('/health-dot serves the public aggregate dot, and unknown when the file is missing', async () => {
  await unlink(DOT_FILE).catch(() => {});
  let res = await app.inject({ method: 'GET', url: '/health-dot' });
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().status, 'unknown'); // missing file reads as unknown, never green
  await writeFile(DOT_FILE, JSON.stringify({ status: 'healthy', updatedAt: '2026-08-02T00:00:00Z' }));
  res = await app.inject({ method: 'GET', url: '/health-dot' });
  assert.deepEqual(res.json(), { status: 'healthy', updatedAt: '2026-08-02T00:00:00Z' });
});

test('the full verdict is served ONLY on the admin listener, never the public app', async () => {
  await writeFile(VERDICT_FILE, JSON.stringify({ overall: 'broken', summary: '1 problem', updatedAt: 'x', problems: [{ service: 'jellyfin', detail: 'down', severity: 'broken' }] }));
  // public/admin split (§5): the main app (which Caddy exposes at zoci.me/api/*) has no verdict route.
  const pub = await app.inject({ method: 'GET', url: '/verdict' });
  assert.equal(pub.statusCode, 404);
  // the admin data listener serves the full verdict.
  const admin = await adminApp.inject({ method: 'GET', url: '/verdict' });
  assert.equal(admin.statusCode, 200);
  assert.equal(admin.json().overall, 'broken');
  assert.equal(admin.json().problems[0].service, 'jellyfin');
});

test('recent-access is served only on the admin listener, most-recent first, never public', async () => {
  await writeFile(
    ACCESS_FILE,
    [
      JSON.stringify({ ts: 1, vhost: 'admin.zoci.me', method: 'GET', path: '/', status: 200, device: 'laptop', user: 'me' }),
      JSON.stringify({ ts: 2, vhost: 'guest.zoci.me', method: 'POST', path: '/command', status: 200, device: '', user: 'g@example.com' }),
    ].join('\n') + '\n',
  );
  const pub = await app.inject({ method: 'GET', url: '/recent-access' });
  assert.equal(pub.statusCode, 404); // audit is never on the public listener
  const admin = await adminApp.inject({ method: 'GET', url: '/recent-access' });
  assert.equal(admin.statusCode, 200);
  const rows = admin.json();
  assert.equal(rows.length, 2);
  assert.equal(rows[0].ts, 2); // most-recent first
});

test('/metrics is not served on the main (Caddy-proxied) app', async () => {
  // Enforces "/metrics never public" (§5): the main app has no /metrics route, so zoci.me/api/metrics
  // cannot reach it. Metrics live only on the separate internal-only listener below.
  const res = await app.inject({ method: 'GET', url: '/metrics' });
  assert.equal(res.statusCode, 404);
});

test('the metrics listener exposes zoci_api_* with route templates, and inflight rebalances', async () => {
  await app.inject({ method: 'GET', url: '/health' });
  await app.inject({ method: 'GET', url: '/health' });
  brokerResponse = () => new Response('{}', { status: 200 });
  const res = await metricsApp.inject({ method: 'GET', url: '/metrics' });
  assert.equal(res.statusCode, 200);
  const body = res.payload;
  // route label is the registered template, and status is the code (labels render sorted).
  assert.match(body, /zoci_api_requests_total\{route="\/health",status="200"\} \d+/);
  assert.match(body, /zoci_api_request_duration_seconds_bucket\{le="\+Inf",route="\/health"\}/);
  assert.match(body, /zoci_api_request_duration_seconds_count\{route="\/health"\}/);
  // inflight is a gauge that returns to 0 once every request has completed.
  assert.match(body, /zoci_api_inflight_requests 0\b/);
});

test('the metrics listener merges ha-broker metrics (VM never scrapes the broker directly)', async () => {
  brokerResponse = () => new Response('zoci_ha_reachable 1\n', { status: 200 });
  const res = await metricsApp.inject({ method: 'GET', url: '/metrics' });
  assert.equal(res.statusCode, 200);
  assert.ok(res.payload.includes('zoci_ha_reachable 1')); // fetched from BROKER_URL/metrics and appended
  assert.ok(calls.some((c) => c.url === 'http://broker.test/metrics'));
});

test('the metrics listener still serves api metrics when the broker is unreachable', async () => {
  brokerResponse = () => {
    throw new Error('broker down');
  };
  const res = await metricsApp.inject({ method: 'GET', url: '/metrics' });
  assert.equal(res.statusCode, 200);
  assert.ok(res.payload.includes('zoci_api_requests_total')); // api's own metrics still present
});

test('the guest page escapes the email and does not treat it as a replace pattern', async () => {
  // `$&` is the classic String.replace pitfall: a literal-string replacement would expand it to
  // the matched token (__EMAIL__). The code uses a function replacer, so it stays literal.
  const res = await app.inject({
    method: 'GET',
    url: '/guest/',
    headers: { 'x-auth-request-email': 'a$&<b>@example.com' },
  });
  assert.equal(res.statusCode, 200);
  const html = res.payload;
  assert.ok(html.includes('a$&amp;&lt;b&gt;@example.com')); // escaped, and $& left intact
  assert.ok(!html.includes('__EMAIL__')); // slot filled; $& did not re-expand into it
  assert.ok(!html.includes('/*__THEME__*/')); // theme slot filled
  assert.ok(!html.includes('__BASE__')); // base slot filled
});
