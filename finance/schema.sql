-- Finance dashboard schema (see ~/specs/finance-dashboard.md). Idempotent: applied on every start.
-- The access token is the only credential stored, and only in encrypted form (see src/crypto.ts).

create table if not exists items (
  item_id             text primary key,
  institution_id      text,
  institution_name    text,
  access_token_enc    text not null,            -- AES-256-GCM; key in infra/.env, never plaintext
  transactions_cursor text,                     -- /transactions/sync cursor
  status              text not null default 'active',  -- active | login_required | error
  last_sync_at        timestamptz,
  last_error          text,
  created_at          timestamptz not null default now()
);

create table if not exists accounts (
  account_id          text primary key,
  item_id             text not null references items(item_id) on delete cascade,
  name                text,
  official_name       text,
  type                text,
  subtype             text,
  mask                text,
  iso_currency_code   text,
  current_balance     numeric,
  available_balance   numeric,
  updated_at          timestamptz not null default now()
);

create table if not exists transactions (
  transaction_id      text primary key,
  account_id          text not null references accounts(account_id) on delete cascade,
  item_id             text not null references items(item_id) on delete cascade,
  date                date,
  authorized_date     date,
  amount              numeric,
  iso_currency_code   text,
  name                text,
  merchant_name       text,
  category_primary    text,
  category_detailed   text,
  pending             boolean default false,
  is_transfer         boolean default false,
  updated_at          timestamptz not null default now()
);
create index if not exists transactions_item_date_idx on transactions (item_id, date);
create index if not exists transactions_merchant_idx on transactions (merchant_name);

create table if not exists recurring_streams (
  stream_id           text primary key,
  item_id             text not null references items(item_id) on delete cascade,
  direction           text,                     -- inflow | outflow
  description         text,
  merchant_name       text,
  category_primary    text,
  average_amount      numeric,
  last_amount         numeric,
  frequency           text,
  is_active           boolean,
  status              text,
  updated_at          timestamptz not null default now()
);

create table if not exists securities (
  security_id         text primary key,
  ticker              text,
  name                text,
  type                text,
  close_price         numeric,
  close_price_as_of   date,
  iso_currency_code   text,
  updated_at          timestamptz not null default now()
);

create table if not exists holdings (
  account_id          text not null references accounts(account_id) on delete cascade,
  security_id         text not null references securities(security_id) on delete cascade,
  quantity            numeric,
  institution_value   numeric,
  cost_basis          numeric,
  iso_currency_code   text,
  updated_at          timestamptz not null default now(),
  primary key (account_id, security_id)
);

create table if not exists investment_transactions (
  investment_transaction_id text primary key,
  account_id          text not null references accounts(account_id) on delete cascade,
  item_id             text not null references items(item_id) on delete cascade,
  security_id         text,
  date                date,
  name                text,
  type                text,
  subtype             text,
  quantity            numeric,
  amount              numeric,
  price               numeric,
  fees                numeric,
  iso_currency_code   text
);
