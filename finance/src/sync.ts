import type {
  AccountBase,
  InvestmentTransaction,
  Security,
  Holding,
  Transaction,
  TransactionStream,
} from 'plaid';
import { plaid } from './plaid.js';
import { pool } from './db.js';
import { decryptToken } from './crypto.js';

// The pull pipeline (see ~/specs/finance-dashboard.md). Plaid returns clean, categorized, deduped
// data; this module persists it. Transactions use the /transactions/sync cursor (added/modified/
// removed) as the incremental + dedupe mechanism; investments have no sync cursor, so holdings and
// investment transactions are fetched whole and reconciled by upsert.

type ItemRow = { item_id: string; access_token_enc: string; transactions_cursor: string | null };

// Plaid personal-finance-category primaries that represent movement between the household's own
// accounts (card payments, transfers). Flagged so the dashboard can exclude them from spend totals
// and net worth, rather than double-counting an outflow and its matching inflow.
const TRANSFER_CATEGORIES = new Set(['TRANSFER_IN', 'TRANSFER_OUT', 'LOAN_PAYMENTS']);

function plaidErrorCode(err: unknown): string | null {
  const e = err as { response?: { data?: { error_code?: string } } };
  return e?.response?.data?.error_code ?? null;
}

async function activeItems(): Promise<ItemRow[]> {
  const { rows } = await pool.query(
    "select item_id, access_token_enc, transactions_cursor from items where status <> 'removed'",
  );
  return rows as ItemRow[];
}

async function upsertAccounts(itemId: string, accounts: AccountBase[]): Promise<void> {
  for (const a of accounts) {
    await pool.query(
      `insert into accounts (account_id, item_id, name, official_name, type, subtype, mask,
         iso_currency_code, current_balance, available_balance, updated_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10, now())
       on conflict (account_id) do update set
         name = excluded.name, official_name = excluded.official_name, type = excluded.type,
         subtype = excluded.subtype, mask = excluded.mask,
         iso_currency_code = excluded.iso_currency_code, current_balance = excluded.current_balance,
         available_balance = excluded.available_balance, updated_at = now()`,
      [
        a.account_id, itemId, a.name, a.official_name, a.type, a.subtype, a.mask,
        a.balances.iso_currency_code, a.balances.current, a.balances.available,
      ],
    );
  }
}

async function upsertTransactions(itemId: string, txns: Transaction[]): Promise<void> {
  for (const t of txns) {
    const primary = t.personal_finance_category?.primary ?? null;
    await pool.query(
      `insert into transactions (transaction_id, account_id, item_id, date, authorized_date, amount,
         iso_currency_code, name, merchant_name, category_primary, category_detailed, pending,
         is_transfer, updated_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13, now())
       on conflict (transaction_id) do update set
         account_id = excluded.account_id, date = excluded.date,
         authorized_date = excluded.authorized_date, amount = excluded.amount,
         iso_currency_code = excluded.iso_currency_code, name = excluded.name,
         merchant_name = excluded.merchant_name, category_primary = excluded.category_primary,
         category_detailed = excluded.category_detailed, pending = excluded.pending,
         is_transfer = excluded.is_transfer, updated_at = now()`,
      [
        t.transaction_id, t.account_id, itemId, t.date, t.authorized_date ?? null, t.amount,
        t.iso_currency_code ?? null, t.name, t.merchant_name ?? null, primary,
        t.personal_finance_category?.detailed ?? null, t.pending,
        primary ? TRANSFER_CATEGORIES.has(primary) : false,
      ],
    );
  }
}

// /transactions/sync: loop the cursor until has_more is false, applying added/modified/removed.
async function syncTransactions(item: ItemRow, accessToken: string): Promise<void> {
  let cursor = item.transactions_cursor ?? undefined;
  for (;;) {
    const res = await plaid.transactionsSync({
      access_token: accessToken,
      count: 500,
      ...(cursor ? { cursor } : {}),
    });
    const data = res.data;
    await upsertTransactions(item.item_id, data.added);
    await upsertTransactions(item.item_id, data.modified);
    const removed = data.removed.map((r) => r.transaction_id).filter((id): id is string => !!id);
    if (removed.length) {
      await pool.query('delete from transactions where transaction_id = any($1)', [removed]);
    }
    cursor = data.next_cursor;
    if (!data.has_more) break;
  }
  await pool.query('update items set transactions_cursor = $1 where item_id = $2', [
    cursor,
    item.item_id,
  ]);
}

// /transactions/recurring/get: Plaid's own inflow/outflow stream detection (the recurring-costs
// panel). account_ids scopes it to this Item's accounts.
async function syncRecurring(
  itemId: string,
  accessToken: string,
  accountIds: string[],
): Promise<void> {
  if (accountIds.length === 0) return;
  const res = await plaid.transactionsRecurringGet({ access_token: accessToken, account_ids: accountIds });
  const streams: { direction: string; s: TransactionStream }[] = [
    ...res.data.inflow_streams.map((s) => ({ direction: 'inflow', s })),
    ...res.data.outflow_streams.map((s) => ({ direction: 'outflow', s })),
  ];
  for (const { direction, s } of streams) {
    await pool.query(
      `insert into recurring_streams (stream_id, item_id, direction, description, merchant_name,
         category_primary, average_amount, last_amount, frequency, is_active, status, updated_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11, now())
       on conflict (stream_id) do update set
         direction = excluded.direction, description = excluded.description,
         merchant_name = excluded.merchant_name, category_primary = excluded.category_primary,
         average_amount = excluded.average_amount, last_amount = excluded.last_amount,
         frequency = excluded.frequency, is_active = excluded.is_active, status = excluded.status,
         updated_at = now()`,
      [
        s.stream_id, itemId, direction, s.description, s.merchant_name ?? null,
        s.personal_finance_category?.primary ?? null, s.average_amount?.amount ?? null,
        s.last_amount?.amount ?? null, s.frequency, s.is_active, s.status,
      ],
    );
  }
}

async function upsertSecurities(securities: Security[]): Promise<void> {
  for (const s of securities) {
    await pool.query(
      `insert into securities (security_id, ticker, name, type, close_price, close_price_as_of,
         iso_currency_code, updated_at)
       values ($1,$2,$3,$4,$5,$6,$7, now())
       on conflict (security_id) do update set
         ticker = excluded.ticker, name = excluded.name, type = excluded.type,
         close_price = excluded.close_price, close_price_as_of = excluded.close_price_as_of,
         iso_currency_code = excluded.iso_currency_code, updated_at = now()`,
      [
        s.security_id, s.ticker_symbol ?? null, s.name ?? null, s.type ?? null, s.close_price ?? null,
        s.close_price_as_of ?? null, s.iso_currency_code ?? null,
      ],
    );
  }
}

async function upsertHoldings(holdings: Holding[]): Promise<void> {
  for (const h of holdings) {
    await pool.query(
      `insert into holdings (account_id, security_id, quantity, institution_value, cost_basis,
         iso_currency_code, updated_at)
       values ($1,$2,$3,$4,$5,$6, now())
       on conflict (account_id, security_id) do update set
         quantity = excluded.quantity, institution_value = excluded.institution_value,
         cost_basis = excluded.cost_basis, iso_currency_code = excluded.iso_currency_code,
         updated_at = now()`,
      [
        h.account_id, h.security_id, h.quantity, h.institution_value, h.cost_basis ?? null,
        h.iso_currency_code ?? null,
      ],
    );
  }
}

async function upsertInvestmentTransactions(
  itemId: string,
  txns: InvestmentTransaction[],
): Promise<void> {
  for (const t of txns) {
    await pool.query(
      `insert into investment_transactions (investment_transaction_id, account_id, item_id,
         security_id, date, name, type, subtype, quantity, amount, price, fees, iso_currency_code)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       on conflict (investment_transaction_id) do update set
         account_id = excluded.account_id, security_id = excluded.security_id, date = excluded.date,
         name = excluded.name, type = excluded.type, subtype = excluded.subtype,
         quantity = excluded.quantity, amount = excluded.amount, price = excluded.price,
         fees = excluded.fees, iso_currency_code = excluded.iso_currency_code`,
      [
        t.investment_transaction_id, t.account_id, itemId, t.security_id ?? null, t.date, t.name,
        t.type, t.subtype, t.quantity, t.amount, t.price, t.fees ?? null, t.iso_currency_code ?? null,
      ],
    );
  }
}

// Investments has no incremental sync: fetch holdings whole, and page investment transactions over a
// two-year window, reconciling by upsert.
async function syncInvestments(itemId: string, accessToken: string): Promise<void> {
  const holdingsRes = await plaid.investmentsHoldingsGet({ access_token: accessToken });
  await upsertSecurities(holdingsRes.data.securities);
  await upsertHoldings(holdingsRes.data.holdings);

  const endDate = new Date().toISOString().slice(0, 10);
  const startDate = new Date(Date.now() - 730 * 86400 * 1000).toISOString().slice(0, 10);
  let offset = 0;
  for (;;) {
    const res = await plaid.investmentsTransactionsGet({
      access_token: accessToken,
      start_date: startDate,
      end_date: endDate,
      options: { count: 500, offset },
    });
    await upsertSecurities(res.data.securities);
    await upsertInvestmentTransactions(itemId, res.data.investment_transactions);
    offset += res.data.investment_transactions.length;
    if (res.data.investment_transactions.length === 0) break;
    if (offset >= res.data.total_investment_transactions) break;
  }
}

// Pull one Item across all products. Investments are best-effort: an Item with no investment accounts
// (a pure spending Item) returns an error for the investment endpoints, which must not fail the whole
// pull. On ITEM_LOGIN_REQUIRED the Item is flagged for update-mode re-auth.
export async function syncItem(item: ItemRow): Promise<void> {
  const accessToken = decryptToken(item.access_token_enc);
  try {
    const accts = await plaid.accountsGet({ access_token: accessToken });
    await upsertAccounts(item.item_id, accts.data.accounts);
    const accountIds = accts.data.accounts.map((a) => a.account_id);

    await syncTransactions(item, accessToken);
    await syncRecurring(item.item_id, accessToken, accountIds);
    try {
      await syncInvestments(item.item_id, accessToken);
    } catch (err) {
      // No investment accounts on this Item (or investments not covered): keep the spending pull.
      if (plaidErrorCode(err) !== 'PRODUCTS_NOT_SUPPORTED') throw err;
    }

    await pool.query(
      "update items set last_sync_at = now(), status = 'active', last_error = null where item_id = $1",
      [item.item_id],
    );
  } catch (err) {
    const code = plaidErrorCode(err);
    const status = code === 'ITEM_LOGIN_REQUIRED' ? 'login_required' : 'error';
    await pool.query('update items set status = $1, last_error = $2 where item_id = $3', [
      status,
      code ?? String(err),
      item.item_id,
    ]);
    throw err;
  }
}

// Pull every linked Item. One Item's failure is recorded on that Item and does not stop the others.
export async function syncAll(): Promise<void> {
  for (const item of await activeItems()) {
    try {
      await syncItem(item);
    } catch {
      /* recorded on the item row; continue with the rest */
    }
  }
}
