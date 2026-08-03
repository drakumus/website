import { Box, Center, SimpleGrid, Card, Text, Group, ThemeIcon, Stack, Paper } from '@mantine/core';
import { motion } from 'motion/react';
import { Link } from 'react-router';
import { AnimatedBackground } from '../components/AnimatedBackground';
import { useHealthDot } from '../lib/api';
import { panelStyle } from '../theme';

type Destination = { title: string; desc: string; to: string; external: boolean; emoji: string };

const destinations: Destination[] = [
  { title: 'Portfolio', desc: 'Projects & work', to: '/portfolio', external: false, emoji: '🗂️' },
  { title: 'Jellyfin', desc: 'Media server', to: 'https://js1.zoci.me', external: true, emoji: '🎬' },
];

// A public health signal is stale (and shown as unknown) if the dot has not been refreshed within
// this window. The full per-service verdict stays tailnet-only; the public page shows one dot only.
const STALE_MS = 90_000;

type DotState = 'healthy' | 'unhealthy' | 'unknown' | 'loading';
const DOT_UI: Record<DotState, { color: string; label: string; glow?: string }> = {
  healthy: { color: '#2ecc71', label: 'All systems operational', glow: '0 0 6px rgba(46,204,113,0.9)' },
  unhealthy: { color: '#e14848', label: 'Investigating an issue' },
  unknown: { color: '#8a8a8a', label: 'Status unavailable' },
  loading: { color: '#555', label: 'Checking status…' },
};

// Public aggregate health: a single dot derived from the same verdict, with no per-service detail.
// A stale or unknown dot shows as "unavailable" rather than a false green.
function ServerStatus() {
  const dot = useHealthDot();
  const loading = dot === null;
  const stale = dot?.updatedAt ? Date.now() - Date.parse(dot.updatedAt) > STALE_MS : true;
  const state: DotState = loading ? 'loading' : stale || dot.status === 'unknown' ? 'unknown' : dot.status;
  const ui = DOT_UI[state];

  return (
    <Paper radius="md" px="md" py="xs" w="100%" style={panelStyle}>
      <Group justify="center" gap="sm" wrap="nowrap">
        <Box
          w={9}
          h={9}
          style={{ borderRadius: '50%', backgroundColor: ui.color, boxShadow: ui.glow, flexShrink: 0 }}
        />
        <Text size="sm" c="dimmed">
          {ui.label}
        </Text>
      </Group>
    </Paper>
  );
}

// Full-viewport launcher: the two links plus a small server-status dashboard.
export default function Landing() {
  return (
    <Box pos="relative" style={{ overflow: 'hidden' }}>
      <AnimatedBackground />
      <Center mih="100dvh" p="md" pos="relative" style={{ zIndex: 1 }}>
        <Stack gap="lg" w="100%" maw={720} align="center">
          <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="lg" w="100%">
            {destinations.map((d, i) => {
              const card = (
                <motion.div
                  initial={{ opacity: 0, y: 24 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.45, delay: i * 0.1 }}
                  style={{ height: '100%' }}
                >
                  {/* Spring hover lift (Motion gesture) to match the portfolio cards. */}
                  <motion.div
                    whileHover={{ y: -6 }}
                    whileTap={{ y: -2 }}
                    transition={{ type: 'spring', stiffness: 320, damping: 22 }}
                    style={{ height: '100%' }}
                  >
                    <Card radius={0} p="xl" h="100%" className="destination-card gold-frame">
                    <span
                      className="frame-shimmer"
                      aria-hidden="true"
                      style={{ animationDelay: `${0.15 + i * 0.12}s` }}
                    />
                    <Group gap="sm" align="center">
                      <ThemeIcon variant="light" size="xl" radius="md">
                        <span style={{ fontSize: 22 }}>{d.emoji}</span>
                      </ThemeIcon>
                      <div>
                        <Text fw={700} size="lg">
                          {d.title}
                        </Text>
                        <Text c="dimmed" size="sm">
                          {d.desc}
                        </Text>
                      </div>
                    </Group>
                    </Card>
                  </motion.div>
                </motion.div>
              );
              const linkStyle = { textDecoration: 'none', color: 'inherit', display: 'block' };
              return d.external ? (
                <a key={d.title} href={d.to} style={linkStyle}>
                  {card}
                </a>
              ) : (
                <Link key={d.title} to={d.to} style={linkStyle}>
                  {card}
                </Link>
              );
            })}
          </SimpleGrid>
          <motion.div
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.45, delay: destinations.length * 0.1 }}
            style={{ width: '100%' }}
          >
            <ServerStatus />
          </motion.div>
        </Stack>
      </Center>
    </Box>
  );
}
