// Round-trips for the cross-boundary contracts. These schemas are the assertion oracle at every
// api/app boundary, so a good value must parse and a malformed one must throw. SERVICES is the
// single source of truth the api and app both read; its shape is guarded here too.
//
// Run: `npm test -w shared` (node --test via tsx).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  HealthResponse,
  SystemStatus,
  ProjectLink,
  ProjectBodyBlock,
  Project,
  SERVICES,
} from '../src/index.ts';

test('HealthResponse accepts ok and rejects anything else', () => {
  assert.deepEqual(HealthResponse.parse({ status: 'ok' }), { status: 'ok' });
  assert.throws(() => HealthResponse.parse({ status: 'degraded' }));
});

test('SystemStatus accepts a well-formed payload and rejects a bad one', () => {
  const good = { containers: [{ name: 'API', running: true }], updatedAt: '2026-01-01T00:00:00Z' };
  assert.deepEqual(SystemStatus.parse(good), good);
  assert.deepEqual(SystemStatus.parse({ containers: [] }).updatedAt, undefined); // updatedAt optional
  assert.throws(() => SystemStatus.parse({ containers: [{ name: 'API', running: 'yes' }] }));
  assert.throws(() => SystemStatus.parse({ containers: {} }));
});

test('ProjectLink validates the href as a URL', () => {
  assert.ok(ProjectLink.safeParse({ label: 'Repo', href: 'https://example.com' }).success);
  assert.ok(!ProjectLink.safeParse({ label: 'Repo', href: 'not-a-url' }).success);
});

test('every ProjectBodyBlock kind round-trips and an unknown kind is rejected', () => {
  const blocks: unknown[] = [
    { kind: 'heading', text: 'H' },
    { kind: 'text', md: '**md**' },
    { kind: 'list', items: ['a', 'b'] },
    { kind: 'image', src: '/i.png', alt: 'alt' },
    { kind: 'video', src: '/v.mp4' },
    { kind: 'youtube', id: 'abc' },
    { kind: 'code', lang: 'ts', src: 'x' },
  ];
  for (const b of blocks) assert.ok(ProjectBodyBlock.safeParse(b).success, JSON.stringify(b));
  assert.ok(!ProjectBodyBlock.safeParse({ kind: 'nope', text: 'x' }).success);
  assert.ok(!ProjectBodyBlock.safeParse({ kind: 'heading' }).success); // missing text
});

test('Project accepts a minimal record and rejects a missing required field', () => {
  const good = { id: 'p', title: 'T', thumbnail: '/t.png', blurb: 'b', tags: [], body: [] };
  assert.ok(Project.safeParse(good).success);
  const { title: _title, ...missingTitle } = good;
  assert.ok(!Project.safeParse(missingTitle).success);
});

test('SERVICES is non-empty with unique containers and complete entries', () => {
  assert.ok(SERVICES.length > 0);
  const containers = SERVICES.map((s) => s.container);
  assert.equal(new Set(containers).size, containers.length); // unique
  for (const s of SERVICES) {
    assert.ok(s.name && s.container, `entry needs name + container: ${JSON.stringify(s)}`);
  }
});
