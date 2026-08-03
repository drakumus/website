import { Configuration, PlaidApi, PlaidEnvironments } from 'plaid';
import { config } from './config.js';

// The single Plaid client. Credentials come from infra/.env; the environment (sandbox|production)
// selects the base URL. This process is the only holder of the Plaid secret (see
// ~/specs/finance-dashboard.md), mirroring how ha-broker is the sole holder of the HA token.
const configuration = new Configuration({
  basePath: PlaidEnvironments[config.plaidEnv],
  baseOptions: {
    headers: {
      'PLAID-CLIENT-ID': config.plaidClientId,
      'PLAID-SECRET': config.plaidSecret,
    },
  },
});

export const plaid = new PlaidApi(configuration);
