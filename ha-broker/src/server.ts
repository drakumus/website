import Fastify from 'fastify';

// Minimal Home Assistant broker (see ~/specs/secure-access.md §6). This is the ONLY process
// that holds the HA token. It exposes a narrow, whitelist-only interface to `api` over the
// shared internal bridge — no host port, not internet-facing. It NEVER accepts a raw HA
// entity_id or service from the caller: the guest sends only an opaque `key`, which this
// process maps to a whitelisted entity + the fixed `light.toggle` service. So the write path
// is as locked as the read path — a compromised `api` (or a nosy guest) can do no more than
// toggle the lights below.

const app = Fastify({ logger: true });

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

const KEY_TO_ENTITY = new Map<string, string>();
for (const r of ROOMS) for (const l of r.lights) KEY_TO_ENTITY.set(l.key, l.entity);

async function ha(path: string, init?: RequestInit): Promise<unknown> {
  const res = await fetch(`http://${HA_ADDR}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${HA_TOKEN}`, 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  });
  if (!res.ok) throw new Error(`HA ${path} -> ${res.status}`);
  return res.json();
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
  if (!HA_ADDR || !HA_TOKEN) return { configured: false, rooms: [] };
  const states = (await ha('/api/states')) as { entity_id: string; state: string }[];
  const stateOf = new Map(states.map((s) => [s.entity_id, s.state]));
  const rooms = ROOMS.map((r) => ({
    room: r.room,
    lights: r.lights.map((l) => ({ key: l.key, label: l.label, state: stateOf.get(l.entity) ?? 'unavailable' })),
  }));
  return { configured: true, rooms };
});

// Toggle a whitelisted light by opaque key. Rejects anything not in the whitelist; the caller
// can never supply an entity_id or a different service. HA's service call returns the changed
// states, so we hand back the new state directly.
app.post('/toggle', async (req, reply) => {
  const key = (req.body as { key?: unknown } | undefined)?.key;
  const entity = typeof key === 'string' ? KEY_TO_ENTITY.get(key) : undefined;
  if (!entity) return reply.code(400).send({ error: 'unknown light' });
  await ha('/api/services/light/toggle', { method: 'POST', body: JSON.stringify({ entity_id: entity }) });
  // Read the settled state back (the service-call response doesn't always include it in time).
  // The dashboard poll remains the source of truth; this is just for snappy UI feedback.
  const s = (await ha(`/api/states/${entity}`)) as { state?: string };
  return { key, state: s.state ?? 'unknown' };
});

app
  .listen({ port: PORT, host: HOST })
  .then((addr) => app.log.info(`ha-broker listening on ${addr}`))
  .catch((err) => {
    app.log.error(err);
    process.exit(1);
  });
