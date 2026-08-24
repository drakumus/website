// Finance backend configuration, read once from the environment. The Plaid credentials and the
// token-encryption key live only in infra/.env (gitignored); see ~/specs/finance-dashboard.md.

export type PlaidEnv = 'sandbox' | 'production';

// Validated, not cast: an unknown value would make the plaid SDK fall back to its production
// base path, silently sending the credentials to production. Fail at startup instead.
const rawPlaidEnv = process.env.PLAID_ENV ?? 'sandbox';
if (rawPlaidEnv !== 'sandbox' && rawPlaidEnv !== 'production') {
  throw new Error(`PLAID_ENV must be "sandbox" or "production", got "${rawPlaidEnv}"`);
}

export const config = {
  port: Number(process.env.PORT ?? 9103),
  host: process.env.HOST ?? '0.0.0.0',
  plaidClientId: process.env.PLAID_CLIENT_ID ?? '',
  plaidSecret: process.env.PLAID_SECRET ?? '',
  plaidEnv: rawPlaidEnv as PlaidEnv,
  // Registered OAuth redirect (finance.zoci.me/...); required for Chase and other OAuth banks.
  redirectUri: process.env.PLAID_REDIRECT_URI || undefined,
  // Base64 of a 32-byte key for AES-256-GCM at-rest encryption of Plaid access tokens.
  tokenKey: process.env.FINANCE_TOKEN_KEY ?? '',
  databaseUrl: process.env.DATABASE_URL ?? 'postgres://finance@localhost:5432/finance',
};

// Whether the Plaid credentials and encryption key are present. Until true, the service stays up on
// /health but /status, /link, and /sync report unconfigured (mirrors ha-broker gating on HA_TOKEN).
export const configured = !!config.plaidClientId && !!config.plaidSecret && !!config.tokenKey;
