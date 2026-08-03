import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Box, Container, Title, Text, Group, Stack, Badge, Button, Table, SimpleGrid } from '@mantine/core';
import { motion } from 'motion/react';
import { usePlaidLink } from 'react-plaid-link';
import { FinanceStatus, FinanceOverview, type FinanceItem } from '@zoci/shared';
import { FrameCard, TopGlow } from '../components/FrameCard';
import { StatTile, BarList, AreaSpark, usd } from './charts';

// The link token is saved before Link opens so it survives an OAuth redirect (Chase and other OAuth
// banks bounce the browser to the bank and back with ?oauth_state_id).
const SAVED_TOKEN = 'zoci_finance_link_token';
const WINDOW_DAYS = 90;

const STATUS_COLOR: Record<string, string> = { active: 'teal', login_required: 'yellow', error: 'red' };

const pretty = (s: string) => s.toLowerCase().replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

function Label({ children }: { children: ReactNode }) {
  return (
    <Text fz="0.72rem" fw={700} tt="uppercase" c="var(--gold-text)" style={{ letterSpacing: '0.07em' }} mb="0.7rem">
      {children}
    </Text>
  );
}

async function loadStatus(): Promise<FinanceStatus> {
  const res = await fetch('/api/status', { cache: 'no-store' });
  return FinanceStatus.parse(await res.json());
}

async function loadOverview(): Promise<FinanceOverview | null> {
  const res = await fetch(`/api/overview?days=${WINDOW_DAYS}`, { cache: 'no-store' });
  if (!res.ok) return null;
  return FinanceOverview.parse(await res.json());
}

// Standalone-preview sample (?preview) so the layout can be reviewed without the backend or Postgres.
const STUB_OVERVIEW: FinanceOverview = {
  netWorth: { assets: 184200, liabilities: 6400, net: 177800 },
  period: { days: WINDOW_DAYS, income: 32100, spend: 18450 },
  topMerchants: [
    { label: 'Amazon', amount: 1240 },
    { label: 'Whole Foods', amount: 980 },
    { label: 'PG&E', amount: 640 },
    { label: 'Shell', amount: 410 },
    { label: 'Netflix', amount: 96 },
  ],
  topCategories: [
    { label: 'RENT_AND_UTILITIES', amount: 3600 },
    { label: 'FOOD_AND_DRINK', amount: 3200 },
    { label: 'GENERAL_MERCHANDISE', amount: 2100 },
    { label: 'TRANSPORTATION', amount: 1400 },
  ],
  spendSeries: [
    { period: '2026-03', amount: 5800 },
    { period: '2026-04', amount: 6200 },
    { period: '2026-05', amount: 5400 },
    { period: '2026-06', amount: 7050 },
  ],
  recurring: [
    { label: 'PG&E', merchant: 'PG&E', category: 'RENT_AND_UTILITIES', amount: 210, frequency: 'MONTHLY' },
    { label: 'Netflix', merchant: 'Netflix', category: 'ENTERTAINMENT', amount: 15.99, frequency: 'MONTHLY' },
    { label: 'Spotify', merchant: 'Spotify', category: 'ENTERTAINMENT', amount: 11.99, frequency: 'MONTHLY' },
  ],
  investments: {
    total: 142000,
    positions: [
      { ticker: 'VTI', name: 'Vanguard Total Market', type: 'etf', quantity: 300, value: 84000 },
      { ticker: 'VXUS', name: 'Vanguard Intl', type: 'etf', quantity: 400, value: 24000 },
      { ticker: 'AAPL', name: 'Apple', type: 'equity', quantity: 100, value: 21000 },
    ],
    byType: [
      { type: 'etf', value: 108000 },
      { type: 'equity', value: 26000 },
      { type: 'cash', value: 8000 },
    ],
  },
};
const STUB_STATUS: FinanceStatus = {
  configured: true,
  items: [
    { item_id: 'itm_1', institution_name: 'Chase', status: 'active', last_sync_at: new Date().toISOString(), last_error: null },
    { item_id: 'itm_2', institution_name: 'Fidelity', status: 'login_required', last_sync_at: null, last_error: null },
  ],
};

// Finance dashboard: the overview (net worth, spend, recurring, investments) with the account link +
// pull controls beneath it.
export default function FinanceApp() {
  const [status, setStatus] = useState<FinanceStatus | null>(null);
  const [overview, setOverview] = useState<FinanceOverview | null>(null);
  const [busy, setBusy] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const opened = useRef<string | null>(null);

  const preview =
    typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('preview');
  const refresh = useCallback(() => {
    if (preview) {
      setStatus(STUB_STATUS);
      setOverview(STUB_OVERVIEW);
      return;
    }
    loadStatus().then(setStatus).catch(() => setStatus({ configured: false, items: [] }));
    loadOverview().then(setOverview).catch(() => setOverview(null));
  }, [preview]);
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

  useEffect(() => {
    if (token && ready && opened.current !== token) {
      opened.current = token;
      open();
    }
  }, [token, ready, open]);

  const startLink = useCallback(async (itemId?: string) => {
    const path = itemId ? '/api/link/token/update' : '/api/link/token/create';
    // Only send a JSON body (and content-type) for update mode; create takes none. A POST with an
    // application/json content-type but an empty body is rejected 400 by Fastify before the handler.
    const init: RequestInit = itemId
      ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ item_id: itemId }) }
      : { method: 'POST' };
    const res = await fetch(path, init);
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
  const ov = overview;
  const inv = ov?.investments;

  return (
    <Box style={{ minHeight: '100vh', position: 'relative' }}>
      <TopGlow />
      <Container size="md" px="md" py="xl">
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

        {!configured ? (
          <Box mt="lg">
            <FrameCard delay={0.05}>
              <Text c="dimmed" size="sm">
                Backend not configured. Set the Plaid credentials and FINANCE_TOKEN_KEY in infra/.env,
                then deploy.
              </Text>
            </FrameCard>
          </Box>
        ) : (
          <Stack gap="md" mt="lg">
            {ov && (
              <FrameCard delay={0.05}>
                <SimpleGrid cols={{ base: 1, sm: 3 }} spacing="lg">
                  <StatTile
                    label="Net worth"
                    value={usd(ov.netWorth.net)}
                    sub={`assets ${usd(ov.netWorth.assets)} · owed ${usd(ov.netWorth.liabilities)}`}
                  />
                  <StatTile label={`Money in · ${WINDOW_DAYS}d`} value={usd(ov.period.income)} />
                  <StatTile label={`Money out · ${WINDOW_DAYS}d`} value={usd(ov.period.spend)} />
                </SimpleGrid>
              </FrameCard>
            )}

            {ov && ov.spendSeries.length > 0 && (
              <FrameCard delay={0.1}>
                <Label>Spending over time</Label>
                <AreaSpark series={ov.spendSeries} />
              </FrameCard>
            )}

            {ov && (
              <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="md">
                <FrameCard delay={0.14}>
                  <Label>Top merchants · {WINDOW_DAYS}d</Label>
                  <BarList items={ov.topMerchants} empty="No spending yet." />
                </FrameCard>
                <FrameCard delay={0.16}>
                  <Label>Top categories · {WINDOW_DAYS}d</Label>
                  <BarList items={ov.topCategories.map((c) => ({ label: pretty(c.label), amount: c.amount }))} empty="No spending yet." />
                </FrameCard>
              </SimpleGrid>
            )}

            {ov && ov.recurring.length > 0 && (
              <FrameCard delay={0.18}>
                <Label>Recurring</Label>
                <Stack gap={0}>
                  {ov.recurring.map((r, i) => (
                    <Group
                      key={`${r.label}-${i}`}
                      justify="space-between"
                      wrap="nowrap"
                      py={7}
                      style={i > 0 ? { borderTop: '1px solid var(--hairline)' } : undefined}
                    >
                      <Box style={{ overflow: 'hidden' }}>
                        <Text fz="0.9rem" fw={600} style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {r.label}
                        </Text>
                        <Text c="dimmed" fz="0.75rem">
                          {r.frequency ? pretty(r.frequency) : ''}
                          {r.category ? ` · ${pretty(r.category)}` : ''}
                        </Text>
                      </Box>
                      <Text fz="0.9rem" fw={600} c="dimmed" style={{ flex: 'none' }}>
                        {usd(r.amount)}
                      </Text>
                    </Group>
                  ))}
                </Stack>
              </FrameCard>
            )}

            {inv && (inv.total > 0 || inv.positions.length > 0) && (
              <FrameCard delay={0.2}>
                <Label>Investments</Label>
                <StatTile label="Portfolio value" value={usd(inv.total)} />
                {inv.byType.length > 0 && (
                  <Box mt="md">
                    <Text c="dimmed" fz="0.75rem" mb="0.4rem">
                      Allocation
                    </Text>
                    <BarList items={inv.byType.map((t) => ({ label: pretty(t.type), amount: t.value }))} />
                  </Box>
                )}
                {inv.positions.length > 0 && (
                  <Box mt="md">
                    <Text c="dimmed" fz="0.75rem" mb="0.4rem">
                      Holdings
                    </Text>
                    <BarList
                      items={inv.positions.map((p) => ({ label: p.ticker ?? p.name ?? '—', amount: p.value }))}
                    />
                  </Box>
                )}
              </FrameCard>
            )}

            <FrameCard delay={0.22}>
              <Label>Accounts</Label>
              <Group mb={items.length > 0 ? 'md' : 0}>
                <Button onClick={() => void startLink()} variant="light">
                  Link an account
                </Button>
                <Button onClick={() => void syncNow()} loading={busy} variant="subtle" disabled={items.length === 0}>
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
                            <Button size="xs" variant="light" color="yellow" onClick={() => void startLink(it.item_id)}>
                              Reconnect
                            </Button>
                          )}
                        </Table.Td>
                      </Table.Tr>
                    ))}
                  </Table.Tbody>
                </Table>
              )}
            </FrameCard>
          </Stack>
        )}
      </Container>
    </Box>
  );
}
