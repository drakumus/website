import Fastify from 'fastify';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { HealthResponse, SystemStatus, SERVICES } from '@zoci/shared';

// v1 backend skeleton (site spec §6): wiring in place, features growing.
const app = Fastify({ logger: true });

const PORT = Number(process.env.PORT ?? 8000);
const HOST = process.env.HOST ?? '0.0.0.0';

// Container health is produced out-of-band by a host cron (infra/status/write-status.sh),
// which writes the names of all running containers to a file. The api reads that file and
// maps it against the canonical SERVICES list — it never talks to Docker, so the
// internet-facing container needs no Docker socket. Prod sets STATUS_FILE via compose; the
// dev default points at the in-repo file.
const STATUS_FILE =
  process.env.STATUS_FILE ??
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../infra/status/status.json');

app.get('/health', async (): Promise<HealthResponse> => {
  return { status: 'ok' };
});

app.get('/status', async (): Promise<SystemStatus> => {
  let running = new Set<string>();
  let updatedAt: string | undefined;
  try {
    const parsed = JSON.parse(await readFile(STATUS_FILE, 'utf8')) as {
      running?: unknown;
      updatedAt?: unknown;
    };
    if (Array.isArray(parsed.running)) {
      running = new Set(parsed.running.filter((x): x is string => typeof x === 'string'));
    }
    if (typeof parsed.updatedAt === 'string') updatedAt = parsed.updatedAt;
  } catch (err) {
    // Missing/unreadable file (cron not running yet): report all down rather than 500.
    app.log.warn({ err }, 'could not read status file');
  }
  return {
    containers: SERVICES.map((s) => ({ name: s.name, running: running.has(s.container) })),
    updatedAt,
  };
});

app
  .listen({ port: PORT, host: HOST })
  .then((addr) => app.log.info(`api listening on ${addr}`))
  .catch((err) => {
    app.log.error(err);
    process.exit(1);
  });
