import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import pg from 'pg';
import { config } from './config.js';

// The single Postgres pool. The finance backend is the only process that reaches this database;
// it is published on host loopback only and never exposed to the LAN or internet.
export const pool = new pg.Pool({ connectionString: config.databaseUrl });

// Apply the idempotent schema (create table if not exists ...). Safe to run on every start. The
// file sits next to the compiled entry (../schema.sql from dist/, and from src/ in dev).
export async function bootstrap(): Promise<void> {
  const dir = path.dirname(fileURLToPath(import.meta.url));
  const schema = await readFile(path.resolve(dir, '../schema.sql'), 'utf8');
  await pool.query(schema);
}
