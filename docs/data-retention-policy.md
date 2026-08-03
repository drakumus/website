# Data Retention & Deletion Policy

**System:** zoci.me self-hosted personal finance dashboard
**Owner / operator:** the operator (sole operator and sole data subject)
**Version:** 1.0  **Effective:** 2026-08-02  **Review cadence:** at least annually and on architecture change

## 1. Scope

This policy governs a single-operator, self-hosted system with one user, who is also the only data
subject. It covers data retrieved from and about the operator's own financial accounts.

## 2. Data held

Transaction, account, balance, and investment-holding data for the operator's own accounts,
retrieved read-only via Plaid, together with encrypted Plaid access tokens. Data is stored in a
local PostgreSQL database on a host the operator controls; access tokens are encrypted at rest with
the key held outside the database.

## 3. Retention

Financial history is retained locally for personal historical reporting for as long as the dashboard
is in use. No data is retained with any hosted or third-party service.

## 4. Deletion

The operator can delete any or all stored data directly at any time, and can revoke or remove Plaid
Items to terminate Plaid's access. On decommissioning, the database and all backups are destroyed
and all Plaid Items are removed.

## 5. Compliance

The operator is the sole user and sole data subject; no other individuals' personal data is
collected or processed, so consumer data-privacy statutes such as the CCPA and GDPR impose no
third-party data-subject obligations. The policy nonetheless applies their core principles: data
minimization, purpose limitation, and deletion on request.

## 6. Review

This policy is reviewed at least annually and whenever the system architecture changes.
