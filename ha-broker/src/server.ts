import Fastify from 'fastify';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// True only when this file is the process entry point (prod `node dist/server.js` or
// `tsx src/server.ts`) — false when imported by a test. Gates listen() + logging below.
const isEntry = path.resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url);

// Minimal Home Assistant broker (see ~/specs/complete/secure-access.md §6). This is the ONLY process
// that holds the HA token. It exposes a narrow, whitelist-only interface to `api` over the
// shared internal bridge — no host port, not internet-facing. It NEVER accepts a raw HA
// entity_id or service from the caller: the guest sends only an opaque `key`, which this
// process maps to a whitelisted entity + the fixed `light` domain (turn_on/turn_off). So the
// write path is as locked as the read path — a compromised `api` (or a nosy guest) can do no
// more than switch the whitelisted lights below.

const app = Fastify({ logger: isEntry });

const PORT = Number(process.env.PORT ?? 8080);
const HOST = '0.0.0.0'; // reachable by `api` on the bridge; compose publishes no host port
const HA_ADDR = process.env.HA_ADDR ?? ''; // LAN, e.g. <HA_LAN_IP>:8123
const HA_TOKEN = process.env.HA_TOKEN ?? '';

// The guest light whitelist: rooms → lights. `key` is opaque (sent by the guest); `entity` is
// the real HA entity_id and never leaves this process. Add/remove here to change what guests see.
type Light = { key: string; label: string; entity: string };
const ROOMS: { room: string; lights: Light[] }[] = [
  { room: 'Guest Bedroom', lights: [{ key: 'gbed', label: 'Main', entity: 'light.guest_bedroom_main_lights' }] },
  { room: 'Guest Bathroom', lights: [
    { key: 'gbath', label: 'Main', entity: 'light.guest_bathroom_main_lights' },
    { key: 'gbathv', label: 'Vanity', entity: 'light.guest_bathroom_vanity_lights' },
  ] },
  { room: 'Living Room', lights: [
    { key: 'living', label: 'Main', entity: 'light.living_room_main_lights' },
    { key: 'livingbathv', label: 'Bathroom Vanity', entity: 'light.living_bathroom_vanity_lights' },
  ] },
  { room: 'Dining Room', lights: [
    { key: 'dining', label: 'Main', entity: 'light.dining_room_main_lights' },
    { key: 'diningaccent', label: 'Accent', entity: 'light.dining_room_accent_lights' },
  ] },
  { room: 'Kitchen', lights: [
    { key: 'kitchen', label: 'Main', entity: 'light.kitchen_main_lights' },
    { key: 'kitchenisland', label: 'Island Pendants', entity: 'light.kitchen_island_pendants' },
    { key: 'kitchensink', label: 'Sink', entity: 'light.kitchen_sink_light' },
  ] },
  { room: 'Hallway & Stairs', lights: [
    { key: 'hallway', label: 'Hallway', entity: 'light.downstairs_hallway_main_lights' },
    { key: 'stairsground', label: 'Stairs (Ground)', entity: 'light.stairs_main_lights_ground' },
    { key: 'stairsliving', label: 'Stairs (Living)', entity: 'light.stairs_main_lights_living' },
  ] },
  { room: 'Front Porch', lights: [{ key: 'porch', label: 'Sconces', entity: 'light.front_porch_sconces' }] },
  { room: 'Laundry', lights: [{ key: 'laundry', label: 'Main', entity: 'light.laundry_room_main_lights' }] },
  { room: 'Delivery', lights: [{ key: 'delivery', label: 'Lights', entity: 'light.delivery_lights' }] },
];

export const KEY_TO_ENTITY = new Map<string, string>();
for (const r of ROOMS) for (const l of r.lights) KEY_TO_ENTITY.set(l.key, l.entity);

// Local-dev mock (GUEST_DEV) so the guest dashboard can be built without a real Home
// Assistant: an in-memory on/off state per whitelisted key, set by /command below. Only
// consulted when HA_ADDR/HA_TOKEN are unset — i.e. never in production. See DEVELOPMENT.md.
const DEV = !!process.env.GUEST_DEV;
const devStates = new Map<string, string>();
if (DEV) {
  for (const k of KEY_TO_ENTITY.keys()) devStates.set(k, 'off');
  for (const k of ['gbed', 'gbathv', 'kitchen', 'kitchenisland', 'dining', 'stairsground']) devStates.set(k, 'on');
  devStates.set('porch', 'unavailable'); // one offline row to exercise that state
}

async function ha(path: string, init?: RequestInit): Promise<unknown> {
  const res = await fetch(`http://${HA_ADDR}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${HA_TOKEN}`, 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  });
  if (!res.ok) throw new Error(`HA ${path} -> ${res.status}`);
  return res.json();
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Verify HA registered a command: re-read the entity until `ok(state)` holds or a short budget
// elapses, returning the last state seen. We're confirming the target attribute updated (which
// is near-instant), NOT waiting for the physical device — so this stays quick and reliable.
async function confirm(entity: string, ok: (state: string) => boolean): Promise<string> {
  const deadline = Date.now() + 3000;
  let state = 'unknown';
  for (;;) {
    try {
      const s = (await ha(`/api/states/${entity}`)) as { state?: string };
      state = s.state ?? 'unknown';
    } catch {
      // Transient read blip — keep trying until the deadline rather than failing a command
      // that already went through. The dashboard poll is the source of truth regardless.
    }
    if (ok(state) || Date.now() >= deadline) return state;
    await sleep(400);
  }
}

// Liveness only — no HA call, so the container is healthy even before HA_TOKEN is set.
app.get('/health', async () => ({ status: 'ok' }));

// Readiness: can we reach HA with the token? Used for verification/ops; exposes no HA data.
app.get('/ha-check', async (_req, reply) => {
  if (!HA_ADDR || !HA_TOKEN) return reply.code(503).send({ ha: 'unconfigured' });
  try {
    await ha('/api/');
    return { ha: 'ok' };
  } catch {
    return reply.code(502).send({ ha: 'unreachable' });
  }
});

// The curated guest view: current on/off state of the whitelisted lights, grouped by room.
// One bulk HA states fetch; nothing outside the whitelist is ever read or returned.
app.get('/dashboard', async (_req, reply) => {
  if (!HA_ADDR || !HA_TOKEN) {
    if (!DEV) return { configured: false, rooms: [] };
    return {
      configured: true,
      rooms: ROOMS.map((r) => ({
        room: r.room,
        lights: r.lights.map((l) => ({ key: l.key, label: l.label, state: devStates.get(l.key) ?? 'off' })),
      })),
    };
  }
  const states = (await ha('/api/states')) as { entity_id: string; state: string }[];
  const stateOf = new Map(states.map((s) => [s.entity_id, s.state]));
  const rooms = ROOMS.map((r) => ({
    room: r.room,
    lights: r.lights.map((l) => ({ key: l.key, label: l.label, state: stateOf.get(l.entity) ?? 'unavailable' })),
  }));
  return { configured: true, rooms };
});

// Drive a whitelisted control to an EXPLICIT desired state, then verify HA accepted it.
// Explicit (turn_on/turn_off, not toggle) so the command is idempotent and the result is
// verifiable. Rejects anything not in the whitelist; the caller never supplies an entity_id or
// a raw service. Response: { key, state, verified } — `verified` = HA converged to `value`.
// Generalizes to other control types: branch on the control's domain to pick the service and
// the verify predicate (e.g. climate.set_temperature + confirm the `temperature` attribute).
app.post('/command', async (req, reply) => {
  const body = (req.body ?? {}) as { key?: unknown; value?: unknown };
  const key = typeof body.key === 'string' ? body.key : '';
  const entity = KEY_TO_ENTITY.get(key);
  if (!entity) return reply.code(400).send({ error: 'unknown control' });
  // Lights accept 'on' | 'off'. (A climate control would validate a number/mode here.)
  if (body.value !== 'on' && body.value !== 'off') return reply.code(400).send({ error: 'bad value' });
  const desired = body.value;

  if (DEV && (!HA_ADDR || !HA_TOKEN)) {
    devStates.set(key, desired);
    return { key, state: desired, verified: true };
  }

  await ha(`/api/services/light/turn_${desired}`, { method: 'POST', body: JSON.stringify({ entity_id: entity }) });
  const state = await confirm(entity, (s) => s === desired);
  return { key, state, verified: state === desired };
});

if (isEntry) {
  app
    .listen({ port: PORT, host: HOST })
    .then((addr) => app.log.info(`ha-broker listening on ${addr}`))
    .catch((err) => {
      app.log.error(err);
      process.exit(1);
    });
}

export { app };
