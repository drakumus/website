import { z } from 'zod';

/**
 * Shared contracts imported by BOTH the SPA (`@zoci/app`) and the API (`@zoci/api`).
 * A change here is a compile error on both ends — no codegen. Keep this the single
 * source of truth for cross-boundary types.
 */

/** GET /api/health */
export const HealthResponse = z.object({
  status: z.literal('ok'),
});
export type HealthResponse = z.infer<typeof HealthResponse>;

/** GET /api/status — home-server container health for the landing dashboard. */
export const ContainerStatus = z.object({
  name: z.string(),
  running: z.boolean(),
});
export type ContainerStatus = z.infer<typeof ContainerStatus>;

export const SystemStatus = z.object({
  containers: z.array(ContainerStatus),
  // ISO timestamp of when the underlying status file was last written (for staleness).
  updatedAt: z.string().optional(),
});
export type SystemStatus = z.infer<typeof SystemStatus>;

/**
 * Canonical home-server services for the landing dashboard: display name + the exact
 * Docker container name to match. Single source of truth — the api maps the cron's list
 * of running containers against this, and the frontend uses the names as placeholders.
 * (Compose project name is `infra`, hence the `infra-<svc>-1` container names.)
 */
export const SERVICES = [
  { name: 'Caddy', container: 'infra-caddy-1' },
  { name: 'Web', container: 'infra-web-1' },
  { name: 'API', container: 'infra-api-1' },
  { name: 'Jellyfin', container: 'jellyfin' },
  { name: 'Hermes', container: 'hermes' },
] as const;

/** Portfolio project (data-driven card + modal). See site spec §3. */
export const ProjectLink = z.object({
  label: z.string(),
  href: z.string().url(),
});
export type ProjectLink = z.infer<typeof ProjectLink>;

export const ProjectBodyBlock = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('heading'), text: z.string() }),
  z.object({ kind: z.literal('text'), md: z.string() }),
  z.object({ kind: z.literal('list'), items: z.array(z.string()) }),
  z.object({ kind: z.literal('image'), src: z.string(), alt: z.string() }),
  z.object({ kind: z.literal('video'), src: z.string(), poster: z.string().optional() }),
  z.object({ kind: z.literal('youtube'), id: z.string() }),
  z.object({ kind: z.literal('code'), lang: z.string(), src: z.string() }),
]);
export type ProjectBodyBlock = z.infer<typeof ProjectBodyBlock>;

export const Project = z.object({
  id: z.string(),
  title: z.string(),
  thumbnail: z.string(),
  blurb: z.string(),
  tags: z.array(z.string()),
  legacy: z.boolean().optional(),
  note: z.string().optional(),
  body: z.array(ProjectBodyBlock),
  links: z.array(ProjectLink).optional(),
});
export type Project = z.infer<typeof Project>;
