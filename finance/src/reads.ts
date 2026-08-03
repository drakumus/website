import { pool } from './db.js';

// Read models for the dashboard (see ~/specs/finance-dashboard.md). Everything the finance page
// needs in one query set: net worth from account balances, spend by merchant/category/month
// (transfers excluded so nothing is double-counted), Plaid's recurring outflow streams, and the
// investment holdings with a by-type allocation. Amounts come out of Postgres numeric as strings, so
// every figure is coerced to a number here; the page only formats.

const num = (v: unknown): number => (v == null ? 0 : Number(v));

export async function overview(days: number) {
  const since = new Date(Date.now() - days * 86400 * 1000).toISOString().slice(0, 10);

  const [balances, merchants, categories, series, inOut, recurring, holdingsTotal, positions, byType] =
    await Promise.all([
      pool.query('select type, coalesce(sum(current_balance), 0) as total from accounts group by type'),
      pool.query(
        `select coalesce(merchant_name, name, 'Unknown') as label, sum(amount) as amount
           from transactions
          where amount > 0 and not is_transfer and not pending and date >= $1
          group by 1 order by amount desc limit 8`,
        [since],
      ),
      pool.query(
        `select coalesce(category_primary, 'OTHER') as label, sum(amount) as amount
           from transactions
          where amount > 0 and not is_transfer and not pending and date >= $1
          group by 1 order by amount desc limit 8`,
        [since],
      ),
      pool.query(
        `select to_char(date_trunc('month', date), 'YYYY-MM') as period, sum(amount) as amount
           from transactions
          where amount > 0 and not is_transfer and not pending and date >= $1
          group by 1 order by 1`,
        [since],
      ),
      pool.query(
        `select
           coalesce(sum(case when amount < 0 and not is_transfer then -amount else 0 end), 0) as income,
           coalesce(sum(case when amount > 0 and not is_transfer then amount else 0 end), 0) as spend
           from transactions where not pending and date >= $1`,
        [since],
      ),
      pool.query(
        `select coalesce(description, merchant_name, 'Recurring') as label, merchant_name,
                category_primary, average_amount, frequency
           from recurring_streams
          where direction = 'outflow' and is_active
          order by average_amount desc nulls last limit 20`,
      ),
      pool.query('select coalesce(sum(institution_value), 0) as total from holdings'),
      pool.query(
        `select s.ticker, s.name, s.type, h.quantity, h.institution_value as value
           from holdings h join securities s on s.security_id = h.security_id
          order by h.institution_value desc nulls last limit 20`,
      ),
      pool.query(
        `select coalesce(s.type, 'other') as type, sum(h.institution_value) as value
           from holdings h join securities s on s.security_id = h.security_id
          group by 1 order by value desc nulls last`,
      ),
    ]);

  const totalByType = new Map<string, number>();
  for (const r of balances.rows) totalByType.set(r.type, num(r.total));
  const assets = (totalByType.get('depository') ?? 0) + (totalByType.get('investment') ?? 0);
  const liabilities = (totalByType.get('credit') ?? 0) + (totalByType.get('loan') ?? 0);

  return {
    netWorth: { assets, liabilities, net: assets - liabilities },
    period: { days, income: num(inOut.rows[0]?.income), spend: num(inOut.rows[0]?.spend) },
    topMerchants: merchants.rows.map((r) => ({ label: r.label as string, amount: num(r.amount) })),
    topCategories: categories.rows.map((r) => ({ label: r.label as string, amount: num(r.amount) })),
    spendSeries: series.rows.map((r) => ({ period: r.period as string, amount: num(r.amount) })),
    recurring: recurring.rows.map((r) => ({
      label: r.label as string,
      merchant: (r.merchant_name ?? null) as string | null,
      category: (r.category_primary ?? null) as string | null,
      amount: num(r.average_amount),
      frequency: (r.frequency ?? null) as string | null,
    })),
    investments: {
      total: num(holdingsTotal.rows[0]?.total),
      positions: positions.rows.map((r) => ({
        ticker: (r.ticker ?? null) as string | null,
        name: (r.name ?? null) as string | null,
        type: (r.type ?? null) as string | null,
        quantity: num(r.quantity),
        value: num(r.value),
      })),
      byType: byType.rows.map((r) => ({ type: r.type as string, value: num(r.value) })),
    },
  };
}
