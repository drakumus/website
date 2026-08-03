// Round-trips for the cross-boundary contracts. These schemas are the assertion oracle at every
// api/app boundary, so a good value must parse and a malformed one must throw.
//
// Run: `npm test -w shared` (node --test via tsx).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HealthResponse, ProjectLink, ProjectBodyBlock, Project } from '../src/index.ts';

test('HealthResponse accepts ok and rejects anything else', () => {
  assert.deepEqual(HealthResponse.parse({ status: 'ok' }), { status: 'ok' });
  assert.throws(() => HealthResponse.parse({ status: 'degraded' }));
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
