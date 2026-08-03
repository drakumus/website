import { Box, Group, Text, Stack } from '@mantine/core';

// Small view pieces for the finance dashboard. Single-hue by design (the site's maroon accent):
// every chart here is one series, so there is no categorical palette to validate and no legend is
// needed (the card title names the series). Text stays in ink tokens; only the marks wear the hue.
const MARK = '#c62828';

export const usd = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n);

export function StatTile({
  label,
  value,
  sub,
  valueColor,
}: {
  label: string;
  value: string;
  sub?: string;
  valueColor?: string;
}) {
  return (
    <Stack gap={2}>
      <Text fz="0.72rem" fw={700} tt="uppercase" c="var(--gold-text)" style={{ letterSpacing: '0.07em' }}>
        {label}
      </Text>
      <Text fz="1.7rem" fw={700} style={{ letterSpacing: '-0.02em', color: valueColor }}>
        {value}
      </Text>
      {sub && (
        <Text c="dimmed" fz="0.8rem">
          {sub}
        </Text>
      )}
    </Stack>
  );
}

// Ranked magnitude → a single-hue horizontal bar list with the value direct-labeled and the bar
// anchored to the baseline (a 4px rounded data-end). Used for merchants, categories, allocation.
export function BarList({
  items,
  empty = 'No data yet.',
}: {
  items: { label: string; amount: number }[];
  empty?: string;
}) {
  if (items.length === 0)
    return (
      <Text c="dimmed" size="sm">
        {empty}
      </Text>
    );
  const max = Math.max(...items.map((i) => i.amount), 1);
  return (
    <Stack gap={9}>
      {items.map((it) => (
        <Box key={it.label}>
          <Group justify="space-between" gap="xs" mb={3} wrap="nowrap">
            <Text fz="0.85rem" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {it.label}
            </Text>
            <Text fz="0.85rem" fw={600} c="dimmed" style={{ flex: 'none' }}>
              {usd(it.amount)}
            </Text>
          </Group>
          <Box style={{ height: 6, borderRadius: 4, background: 'var(--hairline)' }}>
            <Box
              style={{
                width: `${Math.max((it.amount / max) * 100, 2)}%`,
                height: '100%',
                borderRadius: 4,
                background: MARK,
              }}
            />
          </Box>
        </Box>
      ))}
    </Stack>
  );
}

// Single-series change-over-time → a small maroon area (2px line + faint fill). Per-point native
// <title> gives hover. The card title names the series, so no legend.
export function AreaSpark({ series }: { series: { period: string; amount: number }[] }) {
  if (series.length < 2)
    return (
      <Text c="dimmed" size="sm">
        Not enough history yet.
      </Text>
    );
  const W = 640;
  const H = 130;
  const pad = 8;
  const max = Math.max(...series.map((s) => s.amount), 1);
  const x = (i: number) => pad + (i / (series.length - 1)) * (W - 2 * pad);
  const y = (v: number) => H - pad - (v / max) * (H - 2 * pad);
  const line = series.map((s, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(s.amount).toFixed(1)}`).join(' ');
  const area = `${line} L${x(series.length - 1).toFixed(1)},${(H - pad).toFixed(1)} L${x(0).toFixed(1)},${(H - pad).toFixed(1)} Z`;
  return (
    <Box>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        style={{ width: '100%', height: 'auto', display: 'block' }}
        role="img"
        aria-label="Spending over time"
      >
        <path d={area} fill={MARK} fillOpacity={0.14} />
        <path d={line} fill="none" stroke={MARK} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        {series.map((s, i) => (
          <circle key={s.period} cx={x(i)} cy={y(s.amount)} r={3} fill={MARK}>
            <title>{`${s.period}: ${usd(s.amount)}`}</title>
          </circle>
        ))}
      </svg>
      <Group justify="space-between" mt={4}>
        <Text c="dimmed" fz="0.72rem">
          {series[0].period}
        </Text>
        <Text c="dimmed" fz="0.72rem">
          {series[series.length - 1].period}
        </Text>
      </Group>
    </Box>
  );
}
