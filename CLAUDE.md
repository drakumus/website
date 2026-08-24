# Working in this repo

zoci.me: personal site and home server. Read `ARCHITECTURE.md` (system map) and
`DEVELOPMENT.md` (dev loop, verify, deploy) first. This file holds durable how-to-work-here
guidance and deliberately does not restate code behavior (see the first rule).

## Docs reference code, they never restate it
- `.md` files (this one included) point at the code and tests that hold the detail. They do
  not describe current behavior, values, endpoints, or component and class names, which drift
  out of sync. To learn what something does or which primitives exist, read the source it
  points to.
- Enforce invariants with tests, not prose. If a rule matters ("`api` must never see an
  `entity_id`"), it belongs in a test that fails when it breaks, not in a doc that rots.

## This host is production
- `make deploy` builds from the local working tree (not git) and recreates the stack. There is
  no CI/CD. Pushing to GitHub does not deploy. Deploy and push are independent.

## Verify by driving the real thing, locally
- Prefer local checks to reaching the VPS: `curl --resolve <name>:8443:127.0.0.1 ...` exercises
  the public and guest path (the VPS is a dumb L4 passthrough that adds nothing to the app
  logic).
- A change is not done until the affected flow is exercised (health, the guest `302`, a
  toggle), not just typechecked. For UI, screenshot at desktop and mobile (Playwright MCP) and
  compare against the existing surfaces before calling it done. Preview SVGs with `make preview`.

## Reuse, do not reinvent
- Match the existing surfaces instead of rebuilding. The shared visual layer is
  `shared/theme.css` and `app/src`. Reuse those classes and patterns: a new card or panel is the
  existing framed component, not a bare border. Do not fork styling into a new file.
- Cross-boundary types live in `shared/src`. When a value has one home (a token, a theme
  primitive, a whitelist), use it from there, never duplicate it.

## Git: append-only, never rewrite
- `mainline` is active. Land logically grouped commits on top: append-only.
- Never rewrite history. No force-push, and no reset, rebase, or reword of commits that already
  exist, even unpushed. If a landed commit needs a change, add a new commit on top.
- Run `make check-secrets` before every push. Fast-forward pushes only. Commit and push only
  when asked, and read "push" strictly: merging or landing work does not imply pushing it.
- When a review is requested together with a merge or push, run the review first and land the
  fixes before advancing mainline.

## Contribution standards
Commit messages and PR descriptions:
- Line 1: a short, specific summary of the change. Keep each line under 60 characters.
- Optional: a blank line, then a brief paragraph on what changes, plus at most one sentence of
  background. A simple change stays a one-line commit. PR descriptions follow the same shape.
- No Conventional-Commits `type(scope):` prefix. No `Co-Authored-By` trailer.

Wording (commits, comments, docs):
- Professional and plain. No em-dashes. Minimize possessive pronouns.

Naming:
- Prefer obvious names over terse abbreviations: `config`, not `cfg`. Standard acronyms are
  fine (AWS, S3, EC2, ISP, LAN).

## Public repo, no secrets in tracked files
- Real IPs, the tailnet name, VPS host, tokens, secrets, emails, and the TLS key are gitignored
  (see `DEVELOPMENT.md`). Never hardcode an infra address; use `{$ENV}` or `<PLACEHOLDER>`, and
  `make check-secrets` gates this. Keep pinned images current (`make check-updates`): a stale
  version is a recon signal on a public repo.

## Guest and Home Assistant surface
- Preserve the token-isolation boundary: `ha-broker` is the only holder of the HA token, and
  `api` relays only an opaque `{key, value}`. This is an invariant covered by ha-broker tests.
  Keep them green when changing that path.
- `GUEST_DEV` is a local-dev-only auth bypass plus mock HA. Never set it in the deployed compose.

## Taste
- Motion and UI are subtle and spring-based, with content reacting over the container on hover.
  The reference feel is the portfolio interactions in `app/src`. Match that, do not invent a new
  one.
