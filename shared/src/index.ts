import { z } from 'zod';

/**
 * Shared contracts imported by BOTH the SPA (`@zoci/app`) and the API (`@zoci/api`).
 * A change here is a compile error on both ends, no codegen. Keep this the single
 * source of truth for cross-boundary types.
 */

/** GET /api/health */
export const HealthResponse = z.object({
  status: z.literal('ok'),
});
export type HealthResponse = z.infer<typeof HealthResponse>;

/** Portfolio project (data-driven card + modal). See site spec §3. */
export const ProjectLink = z.object({
  label: z.string(),
  href: z.url(),
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

/**
 * GET /api/verdict (tailnet-only admin surface): the whole-system health verdict the admin
 * dashboard renders. Produced by the host-side verdict evaluator (spec §4), consumed by the
 * admin React app. The full verdict is NEVER served on the public zoci.me/api/* path; only a
 * single aggregate boolean (the public health dot) crosses that boundary.
 */
export const AdminVerdictProblem = z.object({
  service: z.string(),
  detail: z.string(),
  severity: z.enum(['broken', 'degraded']),
});
export type AdminVerdictProblem = z.infer<typeof AdminVerdictProblem>;

export const AdminVerdict = z.object({
  overall: z.enum(['healthy', 'degraded', 'broken', 'unknown']),
  summary: z.string(),
  updatedAt: z.string().nullable(),
  problems: z.array(AdminVerdictProblem),
});
export type AdminVerdict = z.infer<typeof AdminVerdict>;

/**
 * GET /api/health-dot (public): the single aggregate health status vended to the public front
 * page. The ONLY health signal that crosses to zoci.me: no per-service or internal detail. The
 * page renders green/red/gray and treats a stale updatedAt as "unknown".
 */
export const HealthDot = z.object({
  status: z.enum(['healthy', 'unhealthy', 'unknown']),
  updatedAt: z.string().optional(),
});
export type HealthDot = z.infer<typeof HealthDot>;

/**
 * GET /api/recent-access (tailnet-only admin surface): recent access-audit records, most-recent
 * first. Identity is the accessing tailnet device (login) or, for guest, the oauth2 email. Served
 * only on the admin listener, never the public path; the raw log and store stay host-only (§5/§6).
 */
export const AccessRecord = z.object({
  ts: z.number(),
  vhost: z.string(),
  method: z.string(),
  path: z.string(),
  status: z.number(),
  device: z.string(),
  user: z.string(),
});
export type AccessRecord = z.infer<typeof AccessRecord>;
export const RecentAccess = z.array(AccessRecord);
export type RecentAccess = z.infer<typeof RecentAccess>;
