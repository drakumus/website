import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { config } from './config.js';

// AES-256-GCM at-rest encryption for Plaid access tokens. The key lives only in infra/.env
// (FINANCE_TOKEN_KEY, base64 of 32 bytes), never in the database, so a database dump is unusable
// without it (see ~/specs/finance-dashboard.md, Operational lifecycle).

function key(): Buffer {
  const k = Buffer.from(config.tokenKey, 'base64');
  if (k.length !== 32) throw new Error('FINANCE_TOKEN_KEY must be the base64 of 32 bytes');
  return k;
}

// Serialized as nonce.tag.ciphertext, each base64url, so a stored value carries everything decrypt
// needs except the key.
export function encryptToken(plaintext: string): string {
  const nonce = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(), nonce);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [nonce, tag, ciphertext].map((b) => b.toString('base64url')).join('.');
}

export function decryptToken(stored: string): string {
  const parts = stored.split('.');
  if (parts.length !== 3) throw new Error('malformed encrypted token');
  const [nonce, tag, ciphertext] = parts.map((s) => Buffer.from(s, 'base64url'));
  const decipher = createDecipheriv('aes-256-gcm', key(), nonce);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}
