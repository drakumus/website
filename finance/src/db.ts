import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import pg from 'pg';
import { config } from './config.js';

// The single Postgres pool. The finance backend is the only process that reaches this database;
// it is published on host loopback only and never exposed to the LAN or internet.
export const pool = new pg.Pool({ connectionString: config.databaseUrl });

// Apply the idempotent schema (create table if not exists ...). Safe to run on every start. The
// file sits next to the entry (../schema.sql from src/ under tsx, and from dist/ when compiled).
// Retries briefly so a first boot that races Postgres coming up still lands the schema.
export async function bootstrap(): Promise<void> {
  const dir = path.dirname(fileURLToPath(import.meta.url));
  const schema = await readFile(path.resolve(dir, '../schema.sql'), 'utf8');
  let lastError: unknown;
  for (let attempt = 0; attempt < 10; attempt++) {
    try {
      await pool.query(schema);
      return;
    } catch (err) {
      lastError = err;
      await new Promise((resolve) => setTimeout(resolve, 1500));
    }
  }
  throw lastError;
}
