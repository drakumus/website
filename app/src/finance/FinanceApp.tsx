import { useCallback, useEffect, useRef, useState } from 'react';
import { Box, Container, Title, Text, Group, Stack, Badge, Button, Table } from '@mantine/core';
import { motion } from 'motion/react';
import { usePlaidLink } from 'react-plaid-link';
import { FinanceStatus, type FinanceItem } from '@zoci/shared';
import { FrameCard, TopGlow } from '../components/FrameCard';

// The link token is saved before Link opens so it survives an OAuth redirect (Chase and other OAuth
// banks bounce the browser to the bank and back with ?oauth_state_id).
const SAVED_TOKEN = 'zoci_finance_link_token';

const STATUS_COLOR: Record<string, string> = {
  active: 'teal',
  login_required: 'yellow',
  error: 'red',
};

async function loadStatus(): Promise<FinanceStatus> {
  const res = await fetch('/api/status', { cache: 'no-store' });
  return FinanceStatus.parse(await res.json());
}

// Finance dashboard shell: link and manage Plaid Items, and trigger a pull. The analytics views (top
// spenders, recurring, net worth, holdings) build on top once the backend read routes land.
export default function FinanceApp() {
  const [status, setStatus] = useState<FinanceStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const opened = useRef<string | null>(null);

  const refresh = useCallback(() => {
    loadStatus()
      .then(setStatus)
      .catch(() => setStatus({ configured: false, items: [] }));
  }, []);
  useEffect(() => {
    refresh();
  }, [refresh]);

  // Coming back from a bank's OAuth page: restore the saved token so Link resumes.
  const isOAuthReturn =
    typeof window !== 'undefined' && window.location.search.includes('oauth_state_id');
  useEffect(() => {
    if (isOAuthReturn) setToken(localStorage.getItem(SAVED_TOKEN));
  }, [isOAuthReturn]);

  const onSuccess = useCallback(
    async (publicToken: string) => {
      localStorage.removeItem(SAVED_TOKEN);
      setToken(null);
      await fetch('/api/link/exchange', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ public_token: publicToken }),
      });
      // Drop ?oauth_state_id so a refresh does not re-enter the OAuth path.
      if (isOAuthReturn) window.history.replaceState({}, '', window.location.pathname);
      refresh();
    },
    [isOAuthReturn, refresh],
  );

  const { open, ready } = usePlaidLink({
    token,
    onSuccess: (publicToken) => {
      if (publicToken) void onSuccess(publicToken);
    },
    ...(isOAuthReturn ? { receivedRedirectUri: window.location.href } : {}),
  });

  // Open once whenever a token becomes ready (a fresh link start, or an OAuth resume).
  useEffect(() => {
    if (token && ready && opened.current !== token) {
      opened.current = token;
      open();
    }
  }, [token, ready, open]);

  // Begin linking: fetch a link token (update mode when reconnecting an Item), save it so it
  // survives an OAuth redirect, then the effect above opens Link.
  const startLink = useCallback(async (itemId?: string) => {
    const path = itemId ? '/api/link/token/update' : '/api/link/token/create';
    const res = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: itemId ? JSON.stringify({ item_id: itemId }) : undefined,
    });
    const data = (await res.json()) as { link_token?: string };
    if (data.link_token) {
      localStorage.setItem(SAVED_TOKEN, data.link_token);
      setToken(data.link_token);
    }
  }, []);

  const syncNow = useCallback(async () => {
    setBusy(true);
    try {
      await fetch('/api/sync', { method: 'POST' });
      refresh();
    } finally {
      setBusy(false);
    }
  }, [refresh]);

  const configured = status?.configured ?? false;
  const items = status?.items ?? [];

  return (
    <Box style={{ minHeight: '100vh', position: 'relative' }}>
      <TopGlow />
      <Container size="sm" px="md" py="xl">
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
        >
          <Title order={1} className="title-accent" style={{ fontSize: 'clamp(2rem, 7vw, 3.1rem)', margin: 0 }}>
            Finance
          </Title>
          <Text c="dimmed" size="sm" mt={4}>
            zoci.me home server · tailnet-only
          </Text>
        </motion.div>

        <Box mt="lg">
          <FrameCard delay={0.05}>
            {!configured ? (
              <Text c="dimmed" size="sm">
                Backend not configured. Set the Plaid credentials and FINANCE_TOKEN_KEY in infra/.env,
                then deploy.
              </Text>
            ) : (
              <Stack gap="md">
                <Group>
                  <Button onClick={() => void startLink()} variant="light">
                    Link an account
                  </Button>
                  <Button
                    onClick={() => void syncNow()}
                    loading={busy}
                    variant="subtle"
                    disabled={items.length === 0}
                  >
                    Sync now
                  </Button>
                </Group>

                {items.length === 0 ? (
                  <Text c="dimmed" size="sm">
                    No accounts linked yet.
                  </Text>
                ) : (
                  <Table verticalSpacing={8} fz="0.9rem">
                    <Table.Thead>
                      <Table.Tr>
                        <Table.Th>Institution</Table.Th>
                        <Table.Th w={130}>Status</Table.Th>
                        <Table.Th w={150}>Last synced</Table.Th>
                        <Table.Th />
                      </Table.Tr>
                    </Table.Thead>
                    <Table.Tbody>
                      {items.map((it: FinanceItem) => (
                        <Table.Tr key={it.item_id}>
                          <Table.Td fw={600}>{it.institution_name ?? it.item_id}</Table.Td>
                          <Table.Td>
                            <Badge variant="light" radius="sm" color={STATUS_COLOR[it.status] ?? 'gray'}>
                              {it.status}
                            </Badge>
                          </Table.Td>
                          <Table.Td c="dimmed">
                            {it.last_sync_at ? new Date(it.last_sync_at).toLocaleString() : '—'}
                          </Table.Td>
                          <Table.Td>
                            {it.status === 'login_required' && (
                              <Button
                                size="xs"
                                variant="light"
                                color="yellow"
                                onClick={() => void startLink(it.item_id)}
                              >
                                Reconnect
                              </Button>
                            )}
                          </Table.Td>
                        </Table.Tr>
                      ))}
                    </Table.Tbody>
                  </Table>
                )}
              </Stack>
            )}
          </FrameCard>
        </Box>
      </Container>
    </Box>
  );
}
