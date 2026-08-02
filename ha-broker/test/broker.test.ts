// Invariants for the HA credential broker (the process that holds the token). These enforce the
// token-isolation boundary that used to live only in prose: the caller sends an opaque `key`,
// never an entity_id or a service, and nothing outside the whitelist is ever driven or leaked.
//
// Run: `npm test` (node --test via tsx). No real Home Assistant; `fetch` is stubbed.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';

// Configure a fake HA before importing the broker (it reads env at module load) and stub fetch
// so we can capture exactly what the broker would send to HA. `haState` tracks the light so the
// broker's read-back verify converges immediately (no real device, no 3s wait).
process.env.HA_ADDR = '127.0.0.1:8123';
process.env.HA_TOKEN = 'test-token';
delete process.env.GUEST_DEV;

type Call = { url: string; method: string; body: { entity_id?: string } };
const calls: Call[] = [];
let haState = 'off';
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: unknown, init: { method?: string; body?: string } = {}) => {
  const url = String(input);
  calls.push({ url, method: init.method ?? 'GET', body: init.body ? JSON.parse(init.body) : {} });
  if (url.includes('/api/services/light/turn_on')) haState = 'on';
  else if (url.includes('/api/services/light/turn_off')) haState = 'off';
  if (url.includes('/api/states/')) return new Response(JSON.stringify({ state: haState }), { status: 200 });
  return new Response(JSON.stringify([]), { status: 200 });
}) as typeof fetch;

const { app, KEY_TO_ENTITY } = await import('../src/server.ts');
const KEY = 'gbed'; // a known whitelisted light
const ENTITY = KEY_TO_ENTITY.get(KEY)!;
const reset = () => {
  calls.length = 0;
  haState = 'off';
};
const command = (payload: unknown) => app.inject({ method: 'POST', url: '/command', payload });

after(async () => {
  globalThis.fetch = realFetch;
  await app.close();
});

test('an unknown key is rejected (400) and reaches HA for nothing', async () => {
  reset();
  const res = await command({ key: 'not-a-real-key', value: 'on' });
  assert.equal(res.statusCode, 400);
  assert.equal(calls.length, 0);
});

test('a bad value is rejected (400) and reaches HA for nothing', async () => {
  reset();
  const res = await command({ key: KEY, value: 'toggle' });
  assert.equal(res.statusCode, 400);
  assert.equal(calls.length, 0);
});

test('a valid command drives the MAPPED entity via the fixed light service', async () => {
  reset();
  const res = await command({ key: KEY, value: 'on' });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.json(), { key: KEY, state: 'on', verified: true });
  const svc = calls.find((c) => c.url.includes('/api/services/'))!;
  assert.match(svc.url, /\/api\/services\/light\/turn_on$/);
  assert.equal(svc.body.entity_id, ENTITY);
});

test('a caller-supplied entity_id / service is ignored (token isolation)', async () => {
  reset();
  const res = await command({ key: KEY, value: 'off', entity_id: 'light.evil', service: 'homeassistant.stop' });
  assert.equal(res.statusCode, 200);
  const svcCalls = calls.filter((c) => c.url.includes('/api/services/'));
  assert.equal(svcCalls.length, 1); // exactly one service call…
  assert.match(svcCalls[0].url, /\/api\/services\/light\/turn_off$/); // …in the fixed light domain
  assert.equal(svcCalls[0].body.entity_id, ENTITY); // …on the mapped entity, never light.evil
});

test('/dashboard exposes no HA entity_ids', async () => {
  reset();
  globalThis.fetch = (async (input: unknown) => {
    if (String(input).endsWith('/api/states'))
      return new Response(
        JSON.stringify([
          { entity_id: ENTITY, state: 'on' },
          { entity_id: 'light.secret_bedroom', state: 'on' },
        ]),
        { status: 200 },
      );
    return new Response(JSON.stringify([]), { status: 200 });
  }) as typeof fetch;
  const res = await app.inject({ method: 'GET', url: '/dashboard' });
  assert.equal(res.statusCode, 200);
  assert.ok(!res.payload.includes('entity_id'));
  assert.ok(!res.payload.includes('light.')); // no HA entity ids in the guest-facing payload
});
