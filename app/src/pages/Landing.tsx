import { Box, Center, SimpleGrid, Card, Text, Group, ThemeIcon, Stack, Paper } from '@mantine/core';
import { motion } from 'motion/react';
import { Link } from 'react-router-dom';
import { AnimatedBackground } from '../components/AnimatedBackground';
import { useSystemStatus } from '../lib/api';
import { panelStyle } from '../theme';
import { SERVICES } from '@zoci/shared';

type Destination = { title: string; desc: string; to: string; external: boolean; emoji: string };

const destinations: Destination[] = [
  { title: 'Portfolio', desc: 'Projects & work', to: '/portfolio', external: false, emoji: '🗂️' },
  { title: 'Jellyfin', desc: 'Media server', to: 'https://js1.zoci.me', external: true, emoji: '🎬' },
];

// Fallback labels shown while the first status request is in flight (from the shared
// canonical service list). If the status file goes stale (cron stopped), show unknown.
const SERVICE_NAMES = SERVICES.map((s) => s.name);
const STALE_MS = 90_000;

function StatusDot({ state }: { state: 'up' | 'down' | 'loading' }) {
  const color = state === 'up' ? '#2ecc71' : state === 'down' ? '#e14848' : '#555';
  return (
    <Box
      w={9}
      h={9}
      style={{
        borderRadius: '50%',
        backgroundColor: color,
        boxShadow: state === 'up' ? '0 0 6px rgba(46, 204, 113, 0.9)' : undefined,
        flexShrink: 0,
      }}
    />
  );
}

// Small home-server dashboard: a status dot per Docker container.
function ServerStatus() {
  const status = useSystemStatus();
  const loading = status === null;
  const stale =
    !loading && status.updatedAt ? Date.now() - Date.parse(status.updatedAt) > STALE_MS : false;
  const unknown = loading || stale;
  const items =
    status && status.containers.length > 0
      ? status.containers
      : SERVICE_NAMES.map((name) => ({ name, running: false }));

  return (
    <Paper radius="md" px="md" py="xs" w="100%" style={panelStyle}>
      <Text size="xs" c="dimmed" fw={700} tt="uppercase" ta="center" mb={8} style={{ letterSpacing: 1 }}>
        Server
      </Text>
      <Group justify="center" gap="lg">
        {items.map((c) => (
          <Group
            key={c.name}
            gap={7}
            wrap="nowrap"
            title={`${c.name}: ${unknown ? (loading ? 'checking…' : 'stale') : c.running ? 'running' : 'down'}`}
          >
            <StatusDot state={unknown ? 'loading' : c.running ? 'up' : 'down'} />
            <Text size="sm">{c.name}</Text>
          </Group>
        ))}
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
