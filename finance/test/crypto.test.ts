import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';

// A 32-byte key must be present before the config module reads the environment on import.
process.env.FINANCE_TOKEN_KEY = randomBytes(32).toString('base64');
const { encryptToken, decryptToken } = await import('../src/crypto.ts');

test('token encryption round-trips', () => {
  const secret = 'access-production-1234-5678';
  const enc = encryptToken(secret);
  assert.notEqual(enc, secret);
  assert.equal(decryptToken(enc), secret);
});

test('ciphertext differs across calls (random nonce)', () => {
  assert.notEqual(encryptToken('same-input'), encryptToken('same-input'));
});

test('tampering is rejected by the auth tag', () => {
  const enc = encryptToken('secret');
  const [nonce, tag, ct] = enc.split('.');
  const flipped = Buffer.from(ct, 'base64url');
  flipped[0] ^= 0x01;
  const tampered = [nonce, tag, flipped.toString('base64url')].join('.');
  assert.throws(() => decryptToken(tampered));
});
