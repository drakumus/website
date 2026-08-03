# Information Security & Data Handling Policy

**System:** zoci.me self-hosted personal services
**Owner / operator:** the operator (sole operator and sole user)
**Version:** 1.0  **Effective:** 2026-08-02  **Review cadence:** at least annually and on architecture change

## 1. Scope and program

This policy governs a single-operator, self-hosted set of services running on one production host
and reachable only over a private mesh network. There is one user, who is also the only data
subject. Security controls are documented here and in the system's design specifications
(`secure-access.md`, `ARCHITECTURE.md §7`), and are operationalized through the automated controls,
monitoring, and access auditing described below. The program is reviewed at least annually and
whenever the architecture changes.

## 2. Access control and network isolation

- Services bind to host loopback and are never published to the public internet.
- Private surfaces are reachable only over a device-authenticated mesh VPN (Tailscale), enforced by
  a port-split boundary plus a network ACL. A fail-closed L7 guard returns 404 to any non-tailnet
  request, including requests arriving on the public host's own address.
- Guest access to a limited surface is mediated by OAuth2 forward-authentication.
- Host administration is restricted to key-based SSH. Access is limited to the sole operator on the
  principle of least privilege.

## 3. Authentication

Access to private application surfaces requires the device-authenticated mesh VPN together with the
identity provider's account authentication; host access uses key-based SSH. There are no shared or
anonymous accounts.

## 4. Encryption

- **In transit:** all traffic is served over TLS 1.2+ (TLS 1.3) via a wildcard certificate.
  Outbound calls to third-party APIs (e.g., Plaid) use HTTPS.
- **At rest (credentials):** third-party access tokens and application secrets, including Plaid
  access tokens, are encrypted using authenticated encryption (AES-256-GCM) with the key held
  outside the database, so a database dump or backup is unusable without the separately held key.

## 5. Secrets management

Secrets are stored only in gitignored environment files, never in version control. An automated
secret-scanning gate runs in the test/deploy pipeline and blocks any commit or deploy that would
introduce a secret into the repository.

## 6. System and container hardening

Application containers run as non-root with read-only root filesystems. Container images are pinned
by immutable digest (`tag@sha256`).

## 7. Vulnerability and patch management

Dependencies and container images are pinned and updated on a managed cadence via a dedicated
update-check process. A test matrix gates every deployment, and a post-deploy health smoke test
confirms the release before it is considered live.

## 8. Monitoring, logging, and access auditing

- **Health monitoring:** continuous metrics collection (VictoriaMetrics, node_exporter, and
  application `/metrics` endpoints) feeds a host-side health-verdict evaluator and per-system
  dashboards on a tailnet-only administrative surface.
- **Access auditing:** access to private and guest surfaces is recorded to an append-only audit
  store. Each record resolves the accessing identity (the tailnet device for private surfaces, the
  authenticated email for the guest surface) with method, path, and status. The audit store and the
  underlying access logs contain identities and are therefore host-only, access-restricted, never
  served publicly, and retained for six months.

## 9. Data collected and purpose

The financial component retrieves, read-only, the operator's own account data (transactions,
balances, and investment holdings) via Plaid, together with encrypted Plaid access tokens. The data
is used solely to display the operator's own finances to the operator on a self-hosted dashboard. It
is not a commercial product and has no external users.

## 10. Consent

Account connections are authorized by the operator through Plaid Link's own consent flow. As the
sole user and sole data subject, the operator consents to the collection, processing, and storage of
this data for the stated purpose.

## 11. Third-party data sharing

None. Data is never shared with, sold to, or transmitted to any third party. It resides only on the
operator's own host and is used only to render the operator's own dashboard.

## 12. Data retention and deletion

- **Retention:** financial history is retained locally for personal historical reporting for as long
  as the dashboard is in use.
- **Deletion:** the operator can delete any or all stored data directly at any time, and can
  revoke/remove Plaid Items to terminate Plaid's access. On decommissioning, the database and all
  backups are destroyed and all Plaid Items are removed.
- **Compliance:** the operator is the sole user and sole data subject; no other individuals'
  personal data is collected or processed, so consumer data-privacy statutes such as the CCPA and
  GDPR impose no third-party data-subject obligations. The policy nonetheless applies their core
  principles: data minimization, purpose limitation, and deletion on request.
- **Review:** this retention and deletion policy is reviewed at least annually.

## 13. Incident handling

On suspected compromise or credential exposure, the operator revokes affected credentials and Plaid
Items, rotates the affected secrets and the token-encryption key, and reviews the access-audit store
to scope the event.
