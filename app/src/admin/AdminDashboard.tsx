import { useEffect, useRef, useState } from 'react';
import { Box, Container, Title, Text, Group, Stack, Badge } from '@mantine/core';
import { motion } from 'motion/react';
import type { AdminVerdict, AdminVerdictProblem } from '@zoci/shared';

// Grafana is embedded (iframe) under the same admin.zoci.me origin at /grafana; the themed frame
// wraps its panels. Verdict data comes from api on the admin surface.
const GRAFANA_SRC = '/grafana/d/zoci-general/general?kiosk&theme=dark';
const VERDICT_URL = '/api/verdict';

const LOADING: AdminVerdict = { overall: 'unknown', summary: 'Checking system status…', updatedAt: null, problems: [] };
const UNKNOWN: AdminVerdict = { overall: 'unknown', summary: 'Verdict unavailable', updatedAt: null, problems: [] };
// Standalone-preview sample (?preview) so the layout can be reviewed without api/Grafana.
const STUB: AdminVerdict = {
  overall: 'broken',
  summary: '2 problems',
  updatedAt: '2026-08-02T19:15:00Z',
  problems: [
    { service: 'Jellyfin', detail: 'container down', severity: 'broken' },
    { service: 'API', detail: 'error rate above the 7-day baseline', severity: 'degraded' },
  ],
};

const DOT_COLOR: Record<AdminVerdict['overall'], string> = {
  healthy: '#4bbf73',
  degraded: '#c4a054',
  broken: '#c62828',
  unknown: '#9a9a9a',
};
const SEV_RANK: Record<AdminVerdictProblem['severity'], number> = { broken: 0, degraded: 1 };

function useVerdict(preview: boolean): AdminVerdict {
  const [v, setV] = useState<AdminVerdict>(preview ? STUB : LOADING);
  useEffect(() => {
    if (preview) return;
    let alive = true;
    const load = async () => {
      try {
        const res = await fetch(VERDICT_URL, { cache: 'no-store' });
        const data = res.ok ? ((await res.json()) as AdminVerdict) : UNKNOWN;
        if (alive) setV(data);
      } catch {
        if (alive) setV(UNKNOWN);
      }
    };
    void load();
    const id = setInterval(() => void load(), 30_000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [preview]);
  return v;
}

// The Grafana iframe is same-origin (admin.zoci.me/grafana), so size it to its content height and
// keep it synced as panels lazy-load. This removes Grafana's own inner scrollbar, leaving a single
// page scroll (the container matches the dashboard height).
function useIframeAutoHeight(active: boolean) {
  const ref = useRef<HTMLIFrameElement | null>(null);
  useEffect(() => {
    if (!active) return;
    const iframe = ref.current;
    if (!iframe) return;
    let poll: ReturnType<typeof setInterval> | undefined;
    const measure = () => {
      const doc = iframe.contentDocument;
      if (!doc) return;
      const h = doc.documentElement.scrollHeight;
      if (h && Math.abs(h - iframe.offsetHeight) > 1) iframe.style.height = `${h}px`;
    };
    const onLoad = () => {
      measure();
      clearInterval(poll);
      let n = 0;
      // Panels render progressively; track the growing height for ~16s, then settle.
      poll = setInterval(() => {
        measure();
        if (++n > 40) clearInterval(poll);
      }, 400);
    };
    iframe.addEventListener('load', onLoad);
    window.addEventListener('resize', measure);
    if (iframe.contentDocument?.readyState === 'complete') onLoad();
    return () => {
      iframe.removeEventListener('load', onLoad);
      window.removeEventListener('resize', measure);
      clearInterval(poll);
    };
  }, [active]);
  return ref;
}

function StatusDot({ overall }: { overall: AdminVerdict['overall'] }) {
  const color = DOT_COLOR[overall];
  return (
    <motion.span
      aria-hidden
      style={{ width: 15, height: 15, borderRadius: '50%', background: color, flex: 'none', display: 'inline-block' }}
      animate={
        overall === 'broken'
          ? { boxShadow: ['0 0 0 4px rgba(198,40,40,0.20)', '0 0 0 8px rgba(198,40,40,0.03)', '0 0 0 4px rgba(198,40,40,0.20)'] }
          : { boxShadow: '0 0 0 4px rgba(255,255,255,0.04)' }
      }
      transition={overall === 'broken' ? { duration: 1.8, repeat: Infinity, ease: 'easeInOut' } : { duration: 0.3 }}
    />
  );
}

// A theme gold-frame card: the ::after frame is drawn by the shared class; frame-shimmer is the
// one-time metal gleam. delay staggers the entrance to match the site's subtle rise.
function FrameCard({ children, delay = 0, p = '1.1rem 1.25rem' }: { children: React.ReactNode; delay?: number; p?: string }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1], delay }}
    >
      <Box className="gold-frame" style={{ padding: p, boxShadow: '0 10px 30px -16px rgba(0,0,0,0.75)' }}>
        <span className="frame-shimmer" aria-hidden />
        {children}
      </Box>
    </motion.div>
  );
}

export default function AdminDashboard() {
  const preview = typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('preview');
  const v = useVerdict(preview);
  const frameRef = useIframeAutoHeight(!preview);
  const problems = [...v.problems].sort((a, b) => (SEV_RANK[a.severity] ?? 9) - (SEV_RANK[b.severity] ?? 9));
  const when = v.updatedAt ? `updated ${new Date(v.updatedAt).toLocaleTimeString()}` : '';

  return (
    <Box style={{ minHeight: '100vh', position: 'relative' }}>
      {/* soft top glow, matching the site */}
      <Box
        aria-hidden
        style={{
          position: 'fixed', inset: 0, zIndex: -1, pointerEvents: 'none',
          background: 'radial-gradient(1200px 820px at 50% 0%, rgba(255,255,255,0.05), transparent 60%)',
        }}
      />
      <Container size="lg" px="md" py="xl">
        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}>
          <Title order={1} className="title-accent" style={{ fontSize: 'clamp(2rem, 7vw, 3.1rem)', margin: 0 }}>
            System Health
          </Title>
          <Text c="dimmed" size="sm" mt={4}>
            zoci.me home server · tailnet-only
          </Text>
        </motion.div>

        <Box mt="lg">
          <FrameCard delay={0.05}>
            <Group align="center" gap="sm" wrap="nowrap">
              <StatusDot overall={v.overall} />
              <Text fw={700} fz="1.15rem" style={{ letterSpacing: '-0.01em' }}>
                {v.summary}
              </Text>
              {when && (
                <Text c="dimmed" fz="0.78rem" ml="auto" style={{ whiteSpace: 'nowrap' }}>
                  {when}
                </Text>
              )}
            </Group>
            {problems.length > 0 && (
              <Stack gap={0} mt="sm">
                {problems.map((p, i) => (
                  <Group key={i} gap="sm" align="baseline" wrap="nowrap" py={6} style={i > 0 ? { borderTop: '1px solid var(--hairline)' } : undefined}>
                    <Badge
                      variant="light"
                      radius="sm"
                      color={p.severity === 'broken' ? 'maroon' : 'yellow'}
                      style={{ flex: 'none' }}
                    >
                      {p.severity}
                    </Badge>
                    <Text fw={700}>{p.service}</Text>
                    <Text c="dimmed">{p.detail}</Text>
                  </Group>
                ))}
              </Stack>
            )}
          </FrameCard>
        </Box>

        <Box mt="md">
          <FrameCard delay={0.12} p="0.5rem">
            <Text fz="0.72rem" fw={700} tt="uppercase" c="var(--gold-text)" style={{ letterSpacing: '0.07em' }} m="0.35rem 0.5rem 0.5rem">
              Metrics &amp; history
            </Text>
            {preview ? (
              <Box style={{ height: 480, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Text c="dimmed">Grafana panels embed here.</Text>
              </Box>
            ) : (
              <iframe
                ref={frameRef}
                title="System metrics"
                src={GRAFANA_SRC}
                scrolling="no"
                // Start shorter than the dashboard so scrollHeight reports true content height (it
                // clamps to the viewport when the iframe is taller). On load the effect sizes the
                // iframe to the full grid height at once, so every panel is in-viewport and renders.
                style={{ width: '100%', height: 600, border: 0, display: 'block', background: 'var(--panel)', overflow: 'hidden' }}
              />
            )}
          </FrameCard>
        </Box>
      </Container>
    </Box>
  );
}
