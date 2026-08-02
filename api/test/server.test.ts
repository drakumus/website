// Boundary + templating invariants for the api. The api is a dumb relay in front of ha-broker:
// it must hard-require the oauth2-proxy auth header, forward the opaque {key,value} without ever
// injecting an entity_id, map the status file against the canonical SERVICES list, and HTML-escape
// the (attacker-influenceable) email without treating it as a String.replace pattern.
//
// Run: `npm test -w api` (node --test via tsx). No real broker; `fetch` is stubbed.
import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { writeFile, unlink, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { HealthResponse, SystemStatus, SERVICES } from '@zoci/shared';

// Env is read at module load, so configure it before importing the app. STATUS_FILE points at a
// temp file this suite owns; BROKER_URL is a sentinel host so proxy calls are easy to assert;
// GUEST_DEV is unset so the missing-header guard is exercised (prod has no GUEST_DEV).
const STATUS_FILE = path.join(await mkdtemp(path.join(tmpdir(), 'zoci-api-')), 'status.json');
process.env.STATUS_FILE = STATUS_FILE;
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

const { app } = await import('../src/server.ts');
const AUTH = { 'x-auth-request-email': 'guest@example.com' };

beforeEach(() => {
  calls = [];
  brokerResponse = () => new Response('{}', { status: 200 });
});
after(async () => {
  globalThis.fetch = realFetch;
  await app.close();
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

test('/status maps the running set against the canonical SERVICES list', async () => {
  await writeFile(STATUS_FILE, JSON.stringify({ running: ['caddy', 'infra-api-1'], updatedAt: '2026-01-01T00:00:00Z' }));
  const res = await app.inject({ method: 'GET', url: '/status' });
  assert.equal(res.statusCode, 200);
  const body = SystemStatus.parse(res.json());
  assert.equal(body.updatedAt, '2026-01-01T00:00:00Z');
  assert.equal(body.containers.length, SERVICES.length);
  const running = Object.fromEntries(body.containers.map((c) => [c.name, c.running]));
  assert.equal(running['Caddy'], true);
  assert.equal(running['API'], true);
  assert.equal(running['Web'], false);
  assert.equal(running['Jellyfin'], false);
});

test('/status reports all down (no 500) when the status file is missing', async () => {
  await unlink(STATUS_FILE).catch(() => {});
  const res = await app.inject({ method: 'GET', url: '/status' });
  assert.equal(res.statusCode, 200);
  const body = SystemStatus.parse(res.json());
  assert.ok(body.containers.every((c) => c.running === false));
  assert.equal(body.updatedAt, undefined);
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
